import { NextResponse } from 'next/server';
import { sql, withTx } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/auth';
import { ValidationError } from '@/lib/validators';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TimesheetRow {
  id: string;
  user_id: string;
  month_year: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  comments: string | null;
  rejection_reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  employee_signature: string | null;
  manager_signature: string | null;
  created_at: string;
  updated_at: string;
}

interface EntryRow {
  id: string;
  timesheet_id: string;
  entry_date: string;
  start_time: string | null;
  end_time: string | null;
  break_hours: number;
  total_hours: number;
  remarks: string | null;
  created_at: string;
}

async function loadTimesheet(id: string): Promise<TimesheetRow | null> {
  const { rows } = await sql<TimesheetRow>`
    SELECT id, user_id, month_year, status, comments, rejection_reason,
           approved_by, approved_at, employee_signature, manager_signature,
           created_at, updated_at
      FROM timesheets WHERE id = ${id} LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * GET /api/timesheets/[id]
 * Returns the timesheet + entries + profile fields needed by the admin view.
 * Auth: owner-of-row OR manager/owner role.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser();
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const { rows } = await sql<TimesheetRow & {
      profile_full_name: string;
      profile_phone_e164: string;
      profile_role: 'staff' | 'manager' | 'owner' | 'part_timer';
      profile_hourly_rate: string | null;
      profile_email: string | null;
    }>`
      SELECT t.id, t.user_id, t.month_year, t.status, t.comments, t.rejection_reason,
             t.approved_by, t.approved_at, t.employee_signature, t.manager_signature,
             t.created_at, t.updated_at,
             p.full_name AS profile_full_name,
             p.phone_e164 AS profile_phone_e164,
             p.role AS profile_role,
             p.hourly_rate AS profile_hourly_rate,
             p.email AS profile_email
        FROM timesheets t
        JOIN profiles p ON p.id = t.user_id
       WHERE t.id = ${id}
       LIMIT 1
    `;
    const r = rows[0];
    if (!r) return NextResponse.json({ error: 'Timesheet not found' }, { status: 404 });

    if (r.user_id !== me.id && me.role !== 'manager' && me.role !== 'owner') {
      throw new AuthError('forbidden', 'Cannot view this timesheet');
    }

    const { rows: entries } = await sql<EntryRow>`
      SELECT id, timesheet_id, entry_date::text AS entry_date,
             start_time::text AS start_time, end_time::text AS end_time,
             break_hours, total_hours, remarks, created_at
        FROM timesheet_entries
       WHERE timesheet_id = ${id}
       ORDER BY entry_date ASC
    `;

    const { profile_full_name, profile_phone_e164, profile_role, profile_hourly_rate, profile_email, ...ts } = r;
    return NextResponse.json({
      timesheet: ts,
      entries,
      profile: {
        full_name: profile_full_name,
        phone_e164: profile_phone_e164,
        role: profile_role,
        hourly_rate: profile_hourly_rate === null ? null : Number(profile_hourly_rate),
        email: profile_email,
      },
    });
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('timesheets GET[id] error', e);
    return NextResponse.json({ error: 'Failed to load timesheet' }, { status: 500 });
  }
}

/**
 * PATCH /api/timesheets/[id]
 * Body fields (all optional; whitelisted):
 *  - employee_signature: data-url string. Owner-of-row, only while draft.
 *  - manager_signature : data-url string. Manager/owner.
 *  - status            : draft | submitted | approved | rejected (transitions enforced).
 *  - rejection_reason  : string (when status = rejected).
 *  - comments          : string.
 *
 * Status transitions:
 *  - draft -> submitted        : owner-of-row, signature required
 *  - submitted -> approved     : manager/owner
 *  - submitted -> rejected     : manager/owner (requires rejection_reason)
 *  - rejected -> draft         : owner-of-row (reopen, clears signature + reason)
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser();
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const ts = await loadTimesheet(id);
    if (!ts) return NextResponse.json({ error: 'Timesheet not found' }, { status: 404 });

    const isAdmin = me.role === 'manager' || me.role === 'owner';
    const isOwnerOfRow = ts.user_id === me.id;

    type Update = Partial<{
      employee_signature: string | null;
      manager_signature: string | null;
      status: 'draft' | 'submitted' | 'approved' | 'rejected';
      rejection_reason: string | null;
      comments: string | null;
      approved_by: string | null;
      approved_at: string | null;
    }>;
    const update: Update = {};

    if ('employee_signature' in body) {
      if (!isOwnerOfRow) throw new AuthError('forbidden', 'Only the timesheet owner can sign');
      if (ts.status !== 'draft') throw new ValidationError('Can only sign while in draft');
      update.employee_signature = body.employee_signature == null ? null : String(body.employee_signature);
    }

    if ('manager_signature' in body) {
      if (!isAdmin) throw new AuthError('forbidden', 'Manager or owner access required');
      update.manager_signature = body.manager_signature == null ? null : String(body.manager_signature);
    }

    if ('comments' in body) {
      if (!isOwnerOfRow && !isAdmin) throw new AuthError('forbidden', 'Cannot edit comments');
      update.comments = body.comments == null ? null : String(body.comments);
    }

    if ('status' in body) {
      const target = body.status;
      if (target !== 'draft' && target !== 'submitted' && target !== 'approved' && target !== 'rejected') {
        throw new ValidationError('Invalid status');
      }
      // Enforce transitions.
      if (target === 'submitted') {
        if (!isOwnerOfRow) throw new AuthError('forbidden', 'Only the owner can submit');
        if (ts.status !== 'draft') throw new ValidationError('Only drafts can be submitted');
        const nextSig = update.employee_signature ?? ts.employee_signature;
        if (!nextSig) throw new ValidationError('Employee signature required to submit');
        update.status = 'submitted';
      } else if (target === 'approved') {
        if (!isAdmin) throw new AuthError('forbidden', 'Manager or owner access required');
        if (ts.status !== 'submitted') throw new ValidationError('Only submitted timesheets can be approved');
        update.status = 'approved';
        update.approved_by = me.id;
        update.approved_at = new Date().toISOString();
      } else if (target === 'rejected') {
        if (!isAdmin) throw new AuthError('forbidden', 'Manager or owner access required');
        if (ts.status !== 'submitted') throw new ValidationError('Only submitted timesheets can be rejected');
        const reason = update.rejection_reason ?? (typeof body.rejection_reason === 'string' ? body.rejection_reason.trim() : '');
        if (!reason) throw new ValidationError('rejection_reason required');
        update.status = 'rejected';
        update.rejection_reason = reason;
      } else if (target === 'draft') {
        if (!isOwnerOfRow) throw new AuthError('forbidden', 'Only the owner can reopen');
        if (ts.status !== 'rejected') throw new ValidationError('Only rejected timesheets can be reopened');
        update.status = 'draft';
        update.rejection_reason = null;
        update.employee_signature = null;
      }
    }

    if ('rejection_reason' in body && update.rejection_reason === undefined) {
      if (!isAdmin) throw new AuthError('forbidden', 'Manager or owner access required');
      update.rejection_reason = body.rejection_reason == null ? null : String(body.rejection_reason);
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
    }

    const updated = await withTx(me.id, async (tx) => {
      const r = await tx.query<TimesheetRow>(
        `UPDATE timesheets SET
           employee_signature = COALESCE($1, employee_signature),
           manager_signature  = COALESCE($2, manager_signature),
           comments           = CASE WHEN $3::boolean THEN $4 ELSE comments END,
           status             = COALESCE($5, status),
           rejection_reason   = CASE WHEN $6::boolean THEN $7 ELSE rejection_reason END,
           approved_by        = CASE WHEN $8::boolean THEN $9::uuid ELSE approved_by END,
           approved_at        = CASE WHEN $10::boolean THEN $11::timestamptz ELSE approved_at END,
           updated_at         = NOW()
         WHERE id = $12
         RETURNING id, user_id, month_year, status, comments, rejection_reason,
                   approved_by, approved_at, employee_signature, manager_signature,
                   created_at, updated_at`,
        [
          update.employee_signature === undefined ? null : update.employee_signature,
          update.manager_signature === undefined ? null : update.manager_signature,
          'comments' in update,
          update.comments ?? null,
          update.status ?? null,
          'rejection_reason' in update,
          update.rejection_reason ?? null,
          'approved_by' in update,
          update.approved_by ?? null,
          'approved_at' in update,
          update.approved_at ?? null,
          id,
        ],
      );
      return r.rows[0];
    });

    return NextResponse.json({ timesheet: updated });
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('timesheets PATCH error', e);
    return NextResponse.json({ error: 'Failed to update timesheet' }, { status: 500 });
  }
}

/**
 * DELETE /api/timesheets/[id]
 * Owner-of-row may delete drafts. Manager/owner may delete any.
 * Cascade deletes entries (FK ON DELETE CASCADE in schema).
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser();
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const ts = await loadTimesheet(id);
    if (!ts) return NextResponse.json({ error: 'Timesheet not found' }, { status: 404 });

    const isAdmin = me.role === 'manager' || me.role === 'owner';
    if (ts.user_id !== me.id && !isAdmin) throw new AuthError('forbidden', 'Cannot delete this timesheet');
    if (!isAdmin && ts.status !== 'draft') {
      throw new ValidationError('Only drafts can be deleted by the owner');
    }

    await sql`DELETE FROM timesheets WHERE id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('timesheets DELETE error', e);
    return NextResponse.json({ error: 'Failed to delete timesheet' }, { status: 500 });
  }
}
