import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { hashPin, requireOwner, AuthError } from '@/lib/auth';
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
  role: 'staff' | 'manager' | 'owner' | 'part_timer';
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
    await requireOwner();
    const { rows } = await sql<ProfileRow>`
      SELECT id, phone_e164, full_name, job_title, role,
             annual_leave_balance, medical_leave_balance, hourly_rate,
             is_active, email, created_at
        FROM profiles
        ORDER BY full_name ASC
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
    await requireOwner();

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

    const { rows } = await sql`
      INSERT INTO profiles (phone_e164, full_name, job_title, role, pin_hash, hourly_rate, is_active)
      VALUES (${phone_e164}, ${full_name}, ${job_title}, ${role}, ${pin_hash}, ${hourly_rate}, TRUE)
      RETURNING id, phone_e164, full_name, job_title, role, hourly_rate, is_active, created_at
    `;
    const created = rows[0];

    return NextResponse.json({
      id: created.id,
      phone_e164: created.phone_e164,
      full_name: created.full_name,
      job_title: created.job_title,
      role: created.role,
      hourly_rate: created.hourly_rate,
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
