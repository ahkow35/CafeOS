import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireSuperAdmin, AuthError } from '@/lib/auth';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CafeRow {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  status: 'pending' | 'active' | 'suspended';
  created_at: string;
  approved_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  trial_ends_at: string | null;
  subscription_status: string | null;
}

interface MemberRow {
  user_id: string;
  full_name: string;
  phone_e164: string;
  role: string;
  status: string;
  is_active: boolean;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const { rows: cafeRows } = await sql<CafeRow>`
      SELECT id, slug, name, logo_url, status, created_at, approved_at,
             stripe_customer_id, stripe_subscription_id, trial_ends_at, subscription_status
        FROM cafes WHERE id = ${id} LIMIT 1
    `;
    if (cafeRows.length === 0) return NextResponse.json({ error: 'Cafe not found' }, { status: 404 });

    const { rows: members } = await sql<MemberRow>`
      SELECT m.user_id, p.full_name, p.phone_e164, m.role, m.status, p.is_active
        FROM cafe_memberships m
        JOIN profiles p ON p.id = m.user_id
       WHERE m.cafe_id = ${id}
       ORDER BY m.role, p.full_name
    `;

    return NextResponse.json({ cafe: cafeRows[0], members });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.code === 'unauthorized' ? 401 : 403 });
    }
    console.error('super/cafes/[id] GET error', e);
    return NextResponse.json({ error: 'Failed to load cafe' }, { status: 500 });
  }
}
