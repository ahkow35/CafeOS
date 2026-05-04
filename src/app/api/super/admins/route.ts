import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireSuperAdmin, AuthError } from '@/lib/auth';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AdminRow {
  id: string;
  full_name: string;
  phone_e164: string;
  is_active: boolean;
  created_at: string;
}

export async function GET(): Promise<Response> {
  try {
    await requireSuperAdmin();
    const { rows } = await sql<AdminRow>`
      SELECT id, full_name, phone_e164, is_active, created_at
        FROM profiles
       WHERE is_super_admin = TRUE
       ORDER BY full_name
    `;
    return NextResponse.json({ admins: rows });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.code === 'unauthorized' ? 401 : 403 });
    }
    console.error('super/admins GET error', e);
    return NextResponse.json({ error: 'Failed to load admins' }, { status: 500 });
  }
}

/** Body: { userId, grant: boolean } */
export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await requireSuperAdmin();
    let body: { userId?: unknown; grant?: unknown };
    try {
      body = (await req.json()) as { userId?: unknown; grant?: unknown };
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { userId, grant } = body;
    if (typeof userId !== 'string' || !UUID_RE.test(userId)) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }
    if (typeof grant !== 'boolean') {
      return NextResponse.json({ error: 'grant (boolean) is required' }, { status: 400 });
    }

    if (!grant) {
      // Block self-revoke if last super admin.
      const { rows: others } = await sql<{ id: string }>`
        SELECT id FROM profiles WHERE is_super_admin = TRUE AND id != ${userId} LIMIT 1
      `;
      if (others.length === 0 && userId === caller.id) {
        return NextResponse.json({ error: 'Cannot revoke the last super admin' }, { status: 409 });
      }
    }

    const { rows } = await sql<{ id: string }>`
      UPDATE profiles SET is_super_admin = ${grant}, updated_at = NOW()
       WHERE id = ${userId}
       RETURNING id
    `;
    if (rows.length === 0) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.code === 'unauthorized' ? 401 : 403 });
    }
    console.error('super/admins POST error', e);
    return NextResponse.json({ error: 'Failed to update admin' }, { status: 500 });
  }
}
