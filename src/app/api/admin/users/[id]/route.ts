import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireOwner, AuthError } from '@/lib/auth';
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
    const owner = await requireOwner();
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    // Build a typed update object from whitelisted fields only.
    const update: {
      full_name?: string;
      job_title?: string | null;
      role?: 'staff' | 'manager' | 'owner' | 'part_timer';
      annual_leave_balance?: number;
      medical_leave_balance?: number;
      hourly_rate?: number | null;
      is_active?: boolean;
    } = {};

    if ('full_name' in body) update.full_name = parseFullName(body.full_name);
    if ('job_title' in body) update.job_title = parseJobTitle(body.job_title);
    if ('role' in body) update.role = parseRole(body.role);
    if ('annual_leave_balance' in body) {
      update.annual_leave_balance = parseBalance(body.annual_leave_balance, 'Annual leave balance');
    }
    if ('medical_leave_balance' in body) {
      update.medical_leave_balance = parseBalance(body.medical_leave_balance, 'Medical leave balance');
    }
    if ('hourly_rate' in body) update.hourly_rate = parseHourlyRate(body.hourly_rate);
    if ('is_active' in body) update.is_active = parseBool(body.is_active, 'is_active');

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
    }

    // Owner cannot demote/disable themselves to avoid locking out the only owner account.
    if (id === owner.id) {
      if (update.role && update.role !== 'owner') {
        return NextResponse.json({ error: 'You cannot change your own role' }, { status: 400 });
      }
      if (update.is_active === false) {
        return NextResponse.json({ error: 'You cannot disable your own account' }, { status: 400 });
      }
    }

    // Tagged-template updates: build COALESCE pattern so unspecified columns are unchanged.
    const { rows } = await sql`
      UPDATE profiles SET
        full_name             = COALESCE(${update.full_name ?? null}, full_name),
        job_title             = CASE WHEN ${'job_title' in update}::boolean THEN ${update.job_title ?? null} ELSE job_title END,
        role                  = COALESCE(${update.role ?? null}, role),
        annual_leave_balance  = COALESCE(${update.annual_leave_balance ?? null}, annual_leave_balance),
        medical_leave_balance = COALESCE(${update.medical_leave_balance ?? null}, medical_leave_balance),
        hourly_rate           = CASE WHEN ${'hourly_rate' in update}::boolean THEN ${update.hourly_rate ?? null} ELSE hourly_rate END,
        is_active             = COALESCE(${update.is_active ?? null}, is_active),
        updated_at            = NOW()
      WHERE id = ${id}
      RETURNING id, phone_e164, full_name, job_title, role, annual_leave_balance,
                medical_leave_balance, hourly_rate, is_active, email, created_at
    `;
    if (rows.length === 0) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    const r = rows[0];
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
    const owner = await requireOwner();
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
    if (id === owner.id) {
      return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 });
    }

    const { rowCount } = await sql`DELETE FROM profiles WHERE id = ${id}`;
    if (!rowCount) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('admin/users DELETE error', e);
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
}
