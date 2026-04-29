import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/auth';
import { ValidationError } from '@/lib/validators';

export const runtime = 'nodejs';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

interface TimesheetRow {
  id: string;
  user_id: string;
  month_year: string;
  status: 'draft' | 'submitted' | 'pending_owner' | 'approved' | 'rejected';
  comments: string | null;
  rejection_reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  manager_action_by: string | null;
  manager_action_at: string | null;
  employee_signature: string | null;
  manager_signature: string | null;
  created_at: string;
  updated_at: string;
}

interface JoinedTimesheetRow extends TimesheetRow {
  profile_full_name: string;
  profile_phone_e164: string;
  profile_role: 'staff' | 'manager' | 'owner' | 'part_timer';
  profile_hourly_rate: string | null;
  profile_email: string | null;
}

function joinShape(r: JoinedTimesheetRow) {
  const { profile_full_name, profile_phone_e164, profile_role, profile_hourly_rate, profile_email, ...ts } = r;
  return {
    ...ts,
    profile: {
      full_name: profile_full_name,
      phone_e164: profile_phone_e164,
      role: profile_role,
      hourly_rate: profile_hourly_rate === null ? null : Number(profile_hourly_rate),
      email: profile_email,
    },
  };
}

/**
 * GET /api/timesheets?scope=mine|all&user_id=&status=
 *  - mine: caller's own
 *  - all : manager+owner only; optional filters user_id, status
 */
export async function GET(req: Request) {
  try {
    const me = await requireUser();
    const url = new URL(req.url);
    const scope = url.searchParams.get('scope') ?? 'mine';

    if (scope === 'mine') {
      const { rows } = await sql<TimesheetRow>`
        SELECT id, user_id, month_year, status, comments, rejection_reason,
               approved_by, approved_at, manager_action_by, manager_action_at,
               employee_signature, manager_signature, created_at, updated_at
          FROM timesheets
         WHERE user_id = ${me.id}
         ORDER BY month_year DESC
      `;
      return NextResponse.json({ timesheets: rows });
    }

    if (scope === 'all') {
      if (me.role !== 'manager' && me.role !== 'owner') {
        throw new AuthError('forbidden', 'Manager or owner access required');
      }
      const userId = url.searchParams.get('user_id');
      const status = url.searchParams.get('status');
      const { rows } = await sql<JoinedTimesheetRow>`
        SELECT t.id, t.user_id, t.month_year, t.status, t.comments, t.rejection_reason,
               t.approved_by, t.approved_at, t.manager_action_by, t.manager_action_at,
               t.employee_signature, t.manager_signature, t.created_at, t.updated_at,
               p.full_name AS profile_full_name,
               p.phone_e164 AS profile_phone_e164,
               p.role AS profile_role,
               p.hourly_rate AS profile_hourly_rate,
               p.email AS profile_email
          FROM timesheets t
          JOIN profiles p ON p.id = t.user_id
         WHERE (${userId}::uuid IS NULL OR t.user_id = ${userId}::uuid)
           AND (${status}::text IS NULL OR t.status = ${status}::text)
         ORDER BY t.month_year DESC, p.full_name ASC
      `;
      return NextResponse.json({ timesheets: rows.map(joinShape) });
    }

    return NextResponse.json({ error: `Unknown scope "${scope}"` }, { status: 400 });
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('timesheets GET error', e);
    return NextResponse.json({ error: 'Failed to load timesheets' }, { status: 500 });
  }
}

/**
 * POST /api/timesheets
 * Body: { month_year: 'YYYY-MM' }
 * Creates a draft for the caller. 409 if one already exists.
 */
export async function POST(req: Request) {
  try {
    const me = await requireUser();
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    if (typeof body.month_year !== 'string' || !MONTH_RE.test(body.month_year)) {
      throw new ValidationError('month_year must be YYYY-MM');
    }
    const month_year = body.month_year;

    const { rows: existing } = await sql<{ id: string }>`
      SELECT id FROM timesheets WHERE user_id = ${me.id} AND month_year = ${month_year} LIMIT 1
    `;
    if (existing.length > 0) {
      return NextResponse.json({ error: 'Timesheet already exists for that month', id: existing[0].id }, { status: 409 });
    }

    const { rows } = await sql<TimesheetRow>`
      INSERT INTO timesheets (user_id, month_year, status)
      VALUES (${me.id}, ${month_year}, 'draft')
      RETURNING id, user_id, month_year, status, comments, rejection_reason,
                approved_by, approved_at, manager_action_by, manager_action_at,
                employee_signature, manager_signature, created_at, updated_at
    `;
    return NextResponse.json({ timesheet: rows[0] }, { status: 201 });
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('timesheets POST error', e);
    return NextResponse.json({ error: 'Failed to create timesheet' }, { status: 500 });
  }
}
