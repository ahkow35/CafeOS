import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireTenantUser, AuthError } from '@/lib/auth';

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

/**
 * Roster for any signed-in user within their active cafe. Used by:
 *  - admin/team, admin/manifest, admin/archive, admin/tasks (assignment dropdowns)
 *  - the home page leave widgets
 * Owners can see inactive members; everyone else only sees active ones.
 *
 * role returned is the per-cafe role from cafe_memberships (not profiles.role).
 */
export async function GET() {
  try {
    const ctx = await requireTenantUser();
    const includeInactive = ctx.role === 'owner';

    const { rows } = includeInactive
      ? await sql<ProfileRow>`
          SELECT p.id, p.phone_e164, p.full_name, p.job_title,
                 m.role,
                 p.annual_leave_balance, p.medical_leave_balance, p.hourly_rate,
                 p.is_active, p.email, p.created_at
            FROM profiles p
            JOIN cafe_memberships m ON m.user_id = p.id AND m.cafe_id = ${ctx.cafeId}
           ORDER BY p.full_name ASC
        `
      : await sql<ProfileRow>`
          SELECT p.id, p.phone_e164, p.full_name, p.job_title,
                 m.role,
                 p.annual_leave_balance, p.medical_leave_balance, p.hourly_rate,
                 p.is_active, p.email, p.created_at
            FROM profiles p
            JOIN cafe_memberships m ON m.user_id = p.id AND m.cafe_id = ${ctx.cafeId}
           WHERE p.is_active = TRUE AND m.status = 'active'
           ORDER BY p.full_name ASC
        `;

    return NextResponse.json({
      users: rows.map((r) => ({ ...r, hourly_rate: r.hourly_rate === null ? null : Number(r.hourly_rate) })),
    });
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('profiles GET error', e);
    return NextResponse.json({ error: 'Failed to load profiles' }, { status: 500 });
  }
}
