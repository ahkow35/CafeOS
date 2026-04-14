import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Generates a readable temp password: 4 letters + 4 digits + 1 symbol
function generateTempPassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const symbols = '!@#$';
  let pw = '';
  for (let i = 0; i < 4; i++) pw += letters[Math.floor(Math.random() * letters.length)];
  for (let i = 0; i < 4; i++) pw += digits[Math.floor(Math.random() * digits.length)];
  pw += symbols[Math.floor(Math.random() * symbols.length)];
  return pw;
}

export async function POST(req: NextRequest) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  }

  // ── Verify caller is an owner ─────────────────────────────────────────────
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { data: callerProfile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .single();
  if (callerProfile?.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── Parse + validate body ─────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const full_name = String(body.full_name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const phone = body.phone ? String(body.phone).trim() : null;
  const hourly_rate = body.hourly_rate != null && body.hourly_rate !== ''
    ? Number(body.hourly_rate)
    : null;
  const role = (body.role ?? 'staff') as 'staff' | 'manager' | 'owner' | 'part_timer';

  if (!full_name || !email) {
    return NextResponse.json({ error: 'full_name and email are required' }, { status: 400 });
  }
  if (!['staff', 'manager', 'owner', 'part_timer'].includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }
  if (hourly_rate !== null && (isNaN(hourly_rate) || hourly_rate < 0)) {
    return NextResponse.json({ error: 'Invalid hourly_rate' }, { status: 400 });
  }

  // ── Create auth user ──────────────────────────────────────────────────────
  const tempPassword = generateTempPassword();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name, name: full_name },
  });
  if (createErr || !created?.user) {
    return NextResponse.json(
      { error: createErr?.message ?? 'Failed to create user' },
      { status: 400 },
    );
  }

  // ── Upsert profile (handles both: trigger ran OR trigger missing) ────────
  const { error: profileErr } = await admin
    .from('profiles')
    .upsert(
      {
        id: created.user.id,
        email,
        full_name,
        role,
        phone,
        hourly_rate,
        is_active: true,
      },
      { onConflict: 'id' },
    );

  if (profileErr) {
    // Roll back the auth user so we don't leave orphans
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: profileErr.message }, { status: 400 });
  }

  return NextResponse.json({
    id: created.user.id,
    email,
    full_name,
    role,
    tempPassword,
  });
}
