import { NextResponse } from 'next/server';
import { withTenantTx, sql } from '@/lib/db';
import { hashPin, requireTenantUser, requireOwnerInCafe, AuthError } from '@/lib/auth';
import {
  parseE164,
  parsePin,
  parseRole,
  parseFullName,
  parseJobTitle,
  parseHourlyRate,
  ValidationError,
} from '@/lib/validators';

export const runtime = 'nodejs';

interface ProfileRow {
  id: string;
  phone_e164: string;
  full_name: string;
  job_title: string | null;
  role: 'staff' | 'manager' | 'owner' | 'part_timer'; // per-cafe role from cafe_memberships
  annual_leave_balance: number;
  medical_leave_balance: number;
  hourly_rate: string | null;
  is_active: boolean;
  email: string | null;
  created_at: string;
}

function serialise(r: ProfileRow) {
  return { ...r, hourly_rate: r.hourly_rate === null ? null : Number(r.hourly_rate) };
}

export async function GET() {
  try {
    const ctx = await requireTenantUser();
    requireOwnerInCafe(ctx);

    // Return only members of this cafe, with the per-cafe role from cafe_memberships.
    const { rows } = await sql<ProfileRow>`
      SELECT p.id, p.phone_e164, p.full_name, p.job_title,
             m.role,
             p.annual_leave_balance, p.medical_leave_balance, p.hourly_rate,
             p.is_active, p.email, p.created_at
        FROM profiles p
        JOIN cafe_memberships m ON m.user_id = p.id
       WHERE m.cafe_id = ${ctx.cafeId}
         AND m.status  = 'active'
       ORDER BY p.full_name ASC
    `;
    return NextResponse.json({ users: rows.map(serialise) });
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('admin/users GET error', e);
    return NextResponse.json({ error: 'Failed to load users' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireTenantUser();
    requireOwnerInCafe(ctx);

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const phone_e164 = parseE164(body.phone ?? body.phone_e164);
    const full_name = parseFullName(body.full_name);
    const job_title = parseJobTitle(body.job_title);
    const role = parseRole(body.role ?? 'staff');
    const pin = parsePin(body.pin);
    const hourly_rate = parseHourlyRate(body.hourly_rate);

    const { rows: existing } = await sql`SELECT id FROM profiles WHERE phone_e164 = ${phone_e164} LIMIT 1`;
    if (existing.length > 0) {
      return NextResponse.json({ error: 'A user with this phone already exists' }, { status: 409 });
    }

    const pin_hash = await hashPin(pin);

    // Create profile and cafe membership atomically.
    const created = await withTenantTx(ctx, async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO profiles (phone_e164, full_name, job_title, pin_hash, hourly_rate, is_active)
         VALUES ($1, $2, $3, $4, $5, TRUE)
         RETURNING id, phone_e164, full_name, job_title, hourly_rate, is_active, created_at`,
        [phone_e164, full_name, job_title, pin_hash, hourly_rate],
      );
      const profile = rows[0] as {
        id: string;
        phone_e164: string;
        full_name: string;
        job_title: string | null;
        hourly_rate: string | null;
        is_active: boolean;
        created_at: string;
      };

      await tx.query(
        `INSERT INTO cafe_memberships (cafe_id, user_id, role, status)
         VALUES ($1, $2, $3, 'active')`,
        [ctx.cafeId, profile.id, role],
      );

      return profile;
    });

    return NextResponse.json({
      id: created.id,
      phone_e164: created.phone_e164,
      full_name: created.full_name,
      job_title: created.job_title,
      role,
      hourly_rate: created.hourly_rate === null ? null : Number(created.hourly_rate),
      // Echo back the PIN once so the admin can hand it off; we never store plaintext.
      tempPin: pin,
    });
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('admin/users POST error', e);
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}
