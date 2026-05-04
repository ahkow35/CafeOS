import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireSuperAdmin, AuthError } from '@/lib/auth';

export const runtime = 'nodejs';

interface CafeListRow {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  status: 'pending' | 'active' | 'suspended';
  created_at: string;
  approved_at: string | null;
  member_count: string;
  owner_name: string | null;
  owner_phone: string | null;
}

export async function GET(): Promise<Response> {
  try {
    await requireSuperAdmin();
    const { rows } = await sql<CafeListRow>`
      SELECT c.id, c.slug, c.name, c.logo_url, c.status, c.created_at, c.approved_at,
             COUNT(m.user_id)::text AS member_count,
             op.full_name AS owner_name,
             op.phone_e164 AS owner_phone
        FROM cafes c
        LEFT JOIN cafe_memberships m ON m.cafe_id = c.id AND m.status = 'active'
        LEFT JOIN cafe_memberships om ON om.cafe_id = c.id AND om.role = 'owner'
        LEFT JOIN profiles op ON op.id = om.user_id
       GROUP BY c.id, op.full_name, op.phone_e164
       ORDER BY
         CASE c.status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
         c.created_at DESC
    `;
    return NextResponse.json({
      cafes: rows.map((r) => ({ ...r, member_count: Number(r.member_count) })),
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.code === 'unauthorized' ? 401 : 403 });
    }
    console.error('super/cafes GET error', e);
    return NextResponse.json({ error: 'Failed to load cafes' }, { status: 500 });
  }
}
