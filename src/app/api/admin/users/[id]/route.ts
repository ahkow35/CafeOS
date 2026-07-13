import { NextResponse } from 'next/server';
import { withTenantTx, sql } from '@/lib/db';
import { requireTenantUser, requireOwnerInCafe, AuthError } from '@/lib/auth';
import {
  parseRole,
  parseFullName,
  parseJobTitle,
  parseHourlyRate,
  ValidationError,
} from '@/lib/validators';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseBalance(input: unknown, label: string): number {
  const n = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new ValidationError(`${label} must be a non-negative integer`);
  }
  return n;
}

function parseBool(input: unknown, label: string): boolean {
  if (typeof input !== 'boolean') throw new ValidationError(`${label} must be true or false`);
  return input;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenantUser();
    requireOwnerInCafe(ctx);
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });

    // Verify the target user is a member of this cafe.
    const { rows: memberRows } = await sql<{ role: string }>`
      SELECT role FROM cafe_memberships
       WHERE cafe_id = ${ctx.cafeId}
         AND user_id = ${id}
         AND status  = 'active'
       LIMIT 1
    `;
    if (memberRows.length === 0) {
      return NextResponse.json({ error: 'User not found in this cafe' }, { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    // Split updates by scope. Employment data (job title, leave, pay, per-café
    // active flag) is café-scoped and written to cafe_memberships — an owner can
    // only change a person's terms in THEIR café. Only full_name is global identity.
    const identityUpdate: { full_name?: string } = {};
    const employmentUpdate: {
      job_title?: string | null;
      annual_leave_balance?: number;
      medical_leave_balance?: number;
      hourly_rate?: number | null;
      employment_active?: boolean;
    } = {};

    let newRole: 'staff' | 'manager' | 'owner' | 'part_timer' | undefined;

    if ('full_name' in body) identityUpdate.full_name = parseFullName(body.full_name);
    if ('job_title' in body) employmentUpdate.job_title = parseJobTitle(body.job_title);
    if ('role' in body) newRole = parseRole(body.role);
    if ('annual_leave_balance' in body) {
      employmentUpdate.annual_leave_balance = parseBalance(body.annual_leave_balance, 'Annual leave balance');
    }
    if ('medical_leave_balance' in body) {
      employmentUpdate.medical_leave_balance = parseBalance(body.medical_leave_balance, 'Medical leave balance');
    }
    if ('hourly_rate' in body) employmentUpdate.hourly_rate = parseHourlyRate(body.hourly_rate);
    // The UI's "is_active" toggle maps to café-scoped employment, not the global account.
    if ('is_active' in body) employmentUpdate.employment_active = parseBool(body.is_active, 'is_active');

    const hasIdentity = Object.keys(identityUpdate).length > 0;
    const hasEmployment = Object.keys(employmentUpdate).length > 0;
    if (!hasIdentity && !hasEmployment && newRole === undefined) {
      return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
    }

    // Owner cannot demote/disable themselves to avoid locking out the only owner account.
    if (id === ctx.userId) {
      if (newRole && newRole !== 'owner') {
        return NextResponse.json({ error: 'You cannot change your own role' }, { status: 400 });
      }
      if (employmentUpdate.employment_active === false) {
        return NextResponse.json({ error: 'You cannot disable your own account' }, { status: 400 });
      }
    }

    await withTenantTx(ctx, async (tx) => {
      // Membership role.
      if (newRole !== undefined) {
        await tx.query(
          `UPDATE cafe_memberships SET role = $1
            WHERE cafe_id = $2 AND user_id = $3`,
          [newRole, ctx.cafeId, id],
        );
      }

      // Café-scoped employment fields — scoped to (cafe_id, user_id).
      if (hasEmployment) {
        await tx.query(
          `UPDATE cafe_memberships SET
            job_title             = CASE WHEN $1::boolean THEN $2 ELSE job_title END,
            annual_leave_balance  = COALESCE($3, annual_leave_balance),
            medical_leave_balance = COALESCE($4, medical_leave_balance),
            hourly_rate           = CASE WHEN $5::boolean THEN $6 ELSE hourly_rate END,
            employment_active     = COALESCE($7, employment_active)
           WHERE cafe_id = $8 AND user_id = $9`,
          [
            'job_title' in employmentUpdate,
            employmentUpdate.job_title ?? null,
            employmentUpdate.annual_leave_balance ?? null,
            employmentUpdate.medical_leave_balance ?? null,
            'hourly_rate' in employmentUpdate,
            employmentUpdate.hourly_rate ?? null,
            employmentUpdate.employment_active ?? null,
            ctx.cafeId,
            id,
          ],
        );
      }

      // Global identity — full_name only.
      if (hasIdentity) {
        await tx.query(
          `UPDATE profiles SET full_name = COALESCE($1, full_name), updated_at = NOW() WHERE id = $2`,
          [identityUpdate.full_name ?? null, id],
        );
      }
    });

    // Fetch the final merged state (identity from profiles, employment from membership).
    // is_active in the response reflects the per-café employment flag.
    const { rows: finalRows } = await sql<{
      id: string;
      phone_e164: string;
      full_name: string;
      job_title: string | null;
      role: string;
      annual_leave_balance: number;
      medical_leave_balance: number;
      hourly_rate: string | null;
      is_active: boolean;
      email: string | null;
      created_at: string;
    }>`
      SELECT p.id, p.phone_e164, p.full_name,
             m.role, m.job_title,
             m.annual_leave_balance, m.medical_leave_balance, m.hourly_rate,
             m.employment_active AS is_active, p.email, p.created_at
        FROM profiles p
        JOIN cafe_memberships m ON m.user_id = p.id
       WHERE p.id = ${id}
         AND m.cafe_id = ${ctx.cafeId}
         AND m.status  = 'active'
       LIMIT 1
    `;

    if (finalRows.length === 0) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    const r = finalRows[0];
    return NextResponse.json({
      user: { ...r, hourly_rate: r.hourly_rate === null ? null : Number(r.hourly_rate) },
    });
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('admin/users PATCH error', e);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenantUser();
    requireOwnerInCafe(ctx);
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
    if (id === ctx.userId) {
      return NextResponse.json({ error: 'You cannot remove yourself from the cafe' }, { status: 400 });
    }

    // Remove user from this cafe only (not a global profile delete).
    const { rowCount } = await sql`
      DELETE FROM cafe_memberships
       WHERE cafe_id = ${ctx.cafeId}
         AND user_id = ${id}
    `;
    if (!rowCount) return NextResponse.json({ error: 'User not found in this cafe' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('admin/users DELETE error', e);
    return NextResponse.json({ error: 'Failed to remove user from cafe' }, { status: 500 });
  }
}
