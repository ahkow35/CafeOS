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

    // Build typed update objects — profile fields vs. membership role are split.
    const profileUpdate: {
      full_name?: string;
      job_title?: string | null;
      annual_leave_balance?: number;
      medical_leave_balance?: number;
      hourly_rate?: number | null;
      is_active?: boolean;
    } = {};

    let newRole: 'staff' | 'manager' | 'owner' | 'part_timer' | undefined;

    if ('full_name' in body) profileUpdate.full_name = parseFullName(body.full_name);
    if ('job_title' in body) profileUpdate.job_title = parseJobTitle(body.job_title);
    if ('role' in body) newRole = parseRole(body.role);
    if ('annual_leave_balance' in body) {
      profileUpdate.annual_leave_balance = parseBalance(body.annual_leave_balance, 'Annual leave balance');
    }
    if ('medical_leave_balance' in body) {
      profileUpdate.medical_leave_balance = parseBalance(body.medical_leave_balance, 'Medical leave balance');
    }
    if ('hourly_rate' in body) profileUpdate.hourly_rate = parseHourlyRate(body.hourly_rate);
    if ('is_active' in body) profileUpdate.is_active = parseBool(body.is_active, 'is_active');

    if (Object.keys(profileUpdate).length === 0 && newRole === undefined) {
      return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
    }

    // Owner cannot demote/disable themselves to avoid locking out the only owner account.
    if (id === ctx.userId) {
      if (newRole && newRole !== 'owner') {
        return NextResponse.json({ error: 'You cannot change your own role' }, { status: 400 });
      }
      if (profileUpdate.is_active === false) {
        return NextResponse.json({ error: 'You cannot disable your own account' }, { status: 400 });
      }
    }

    const result = await withTenantTx(ctx, async (tx) => {
      // Update membership role if requested.
      if (newRole !== undefined) {
        await tx.query(
          `UPDATE cafe_memberships SET role = $1
            WHERE cafe_id = $2 AND user_id = $3`,
          [newRole, ctx.cafeId, id],
        );
      }

      // Update profile fields if any.
      if (Object.keys(profileUpdate).length > 0) {
        const { rows } = await tx.query(
          `UPDATE profiles SET
            full_name             = COALESCE($1, full_name),
            job_title             = CASE WHEN $2::boolean THEN $3 ELSE job_title END,
            annual_leave_balance  = COALESCE($4, annual_leave_balance),
            medical_leave_balance = COALESCE($5, medical_leave_balance),
            hourly_rate           = CASE WHEN $6::boolean THEN $7 ELSE hourly_rate END,
            is_active             = COALESCE($8, is_active),
            updated_at            = NOW()
           WHERE id = $9
           RETURNING id, phone_e164, full_name, job_title,
                     annual_leave_balance, medical_leave_balance, hourly_rate,
                     is_active, email, created_at`,
          [
            profileUpdate.full_name ?? null,
            'job_title' in profileUpdate,
            profileUpdate.job_title ?? null,
            profileUpdate.annual_leave_balance ?? null,
            profileUpdate.medical_leave_balance ?? null,
            'hourly_rate' in profileUpdate,
            profileUpdate.hourly_rate ?? null,
            profileUpdate.is_active ?? null,
            id,
          ],
        );
        return rows[0] as {
          id: string;
          phone_e164: string;
          full_name: string;
          job_title: string | null;
          annual_leave_balance: number;
          medical_leave_balance: number;
          hourly_rate: string | null;
          is_active: boolean;
          email: string | null;
          created_at: string;
        } | undefined;
      }
      return undefined;
    });

    // Fetch the final state to return (role may have changed in memberships, profile may have changed).
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
      SELECT p.id, p.phone_e164, p.full_name, p.job_title,
             m.role,
             p.annual_leave_balance, p.medical_leave_balance, p.hourly_rate,
             p.is_active, p.email, p.created_at
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
