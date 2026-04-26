import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/auth';

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
 * Roster for any signed-in user. Used by:
 *  - admin/team, admin/manifest, admin/archive, admin/tasks (assignment dropdowns)
 *  - the home page leave widgets
 * Owners can see disabled accounts; everyone else only sees active ones.
 */
export async function GET() {
  try {
    const me = await requireUser();
    const includeInactive = me.role === 'owner';
    const { rows } = includeInactive
      ? await sql<ProfileRow>`
          SELECT id, phone_e164, full_name, job_title, role,
                 annual_leave_balance, medical_leave_balance, hourly_rate,
                 is_active, email, created_at
            FROM profiles
            ORDER BY full_name ASC
        `
      : await sql<ProfileRow>`
          SELECT id, phone_e164, full_name, job_title, role,
                 annual_leave_balance, medical_leave_balance, hourly_rate,
                 is_active, email, created_at
            FROM profiles
           WHERE is_active = TRUE
            ORDER BY full_name ASC
        `;
    return NextResponse.json({
      users: rows.map((r: ProfileRow) => ({ ...r, hourly_rate: r.hourly_rate === null ? null : Number(r.hourly_rate) })),
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
