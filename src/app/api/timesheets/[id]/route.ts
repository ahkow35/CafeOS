import { NextResponse } from 'next/server';
import { sql, withTx } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/auth';
import { ValidationError } from '@/lib/validators';
import {
  notifyTimesheetSubmitted,
  notifyTimesheetForOwner,
  notifyTimesheetDecision,
} from '@/lib/notifications';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type TimesheetStatus = 'draft' | 'submitted' | 'pending_owner' | 'approved' | 'rejected';

interface TimesheetRow {
  id: string;
  user_id: string;
  month_year: string;
  status: TimesheetStatus;
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

const TS_SELECT = `
  id, user_id, month_year, status, comments, rejection_reason,
  approved_by, approved_at, manager_action_by, manager_action_at,
  employee_signature, manager_signature, created_at, updated_at
`;

async function loadTimesheet(id: string): Promise<TimesheetRow | null> {
  const { rows } = await sql<TimesheetRow>`
    SELECT id, user_id, month_year, status, comments, rejection_reason,
           approved_by, approved_at, manager_action_by, manager_action_at,
           employee_signature, manager_signature, created_at, updated_at
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
             t.approved_by, t.approved_at, t.manager_action_by, t.manager_action_at,
             t.employee_signature, t.manager_signature, t.created_at, t.updated_at,
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
      entries: entries.map(e => ({
        ...e,
        break_hours: Number(e.break_hours),
        total_hours: Number(e.total_hours),
      })),
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
 *  - status            : draft | submitted | pending_owner | approved | rejected
 *  - rejection_reason  : string (when status = rejected).
 *  - comments          : string.
 *
 * Status transitions (2-level approval: part_timer → manager → owner):
 *  - draft         → submitted     : owner-of-row, employee signature required
 *  - submitted     → pending_owner : manager (manager signature required)
 *  - submitted     → approved      : owner (skip-manager direct approve, manager signature required)
 *  - pending_owner → approved      : owner
 *  - submitted     → rejected      : manager or owner (rejection_reason required)
 *  - pending_owner → rejected      : owner only (rejection_reason required)
 *  - rejected      → draft         : owner-of-row (clears signatures + reason + manager-action)
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

    const isManager = me.role === 'manager';
    const isOwner = me.role === 'owner';
    const isAdmin = isManager || isOwner;
    const isOwnerOfRow = ts.user_id === me.id;

    type Update = Partial<{
      employee_signature: string | null;
      manager_signature: string | null;
      status: TimesheetStatus;
      rejection_reason: string | null;
      comments: string | null;
      approved_by: string | null;
      approved_at: string | null;
      manager_action_by: string | null;
      manager_action_at: string | null;
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

    // Capture rejection_reason early so the status branch can require it.
    if ('rejection_reason' in body) {
      if (!isAdmin) throw new AuthError('forbidden', 'Manager or owner access required');
      update.rejection_reason = body.rejection_reason == null ? null : String(body.rejection_reason);
    }

    let notifyEvent: 'submitted' | 'pending_owner' | 'approved' | 'rejected' | null = null;

    if ('status' in body) {
      const target = body.status;
      if (target !== 'draft' && target !== 'submitted' && target !== 'pending_owner'
          && target !== 'approved' && target !== 'rejected') {
        throw new ValidationError('Invalid status');
      }

      if (target === 'submitted') {
        if (!isOwnerOfRow) throw new AuthError('forbidden', 'Only the owner can submit');
        if (ts.status !== 'draft') throw new ValidationError('Only drafts can be submitted');
        const nextSig = update.employee_signature ?? ts.employee_signature;
        if (!nextSig) throw new ValidationError('Employee signature required to submit');
        update.status = 'submitted';
        notifyEvent = 'submitted';

      } else if (target === 'pending_owner') {
        if (!isAdmin) throw new AuthError('forbidden', 'Manager or owner access required');
        if (ts.status !== 'submitted') throw new ValidationError('Only submitted timesheets can be forwarded');
        const nextMgrSig = update.manager_signature ?? ts.manager_signature;
        if (!nextMgrSig) throw new ValidationError('Manager signature required to forward to owner');
        update.status = 'pending_owner';
        update.manager_action_by = me.id;
        update.manager_action_at = new Date().toISOString();
        notifyEvent = 'pending_owner';

      } else if (target === 'approved') {
        if (!isOwner) throw new AuthError('forbidden', 'Owner access required for final approval');
        if (ts.status !== 'submitted' && ts.status !== 'pending_owner') {
          throw new ValidationError('Only submitted or owner-pending timesheets can be approved');
        }
        // If owner approves directly from 'submitted', require manager signature
        // OR allow owner's manager_signature in this same request (they can sign for both).
        const nextMgrSig = update.manager_signature ?? ts.manager_signature;
        if (!nextMgrSig) throw new ValidationError('Manager signature required before approval');
        update.status = 'approved';
        update.approved_by = me.id;
        update.approved_at = new Date().toISOString();
        // Owner-direct approval: stamp manager_action so audit trail is complete.
        if (ts.status === 'submitted' && !ts.manager_action_by) {
          update.manager_action_by = me.id;
          update.manager_action_at = new Date().toISOString();
        }
        notifyEvent = 'approved';

      } else if (target === 'rejected') {
        if (!isAdmin) throw new AuthError('forbidden', 'Manager or owner access required');
        if (ts.status === 'pending_owner' && !isOwner) {
          throw new AuthError('forbidden', 'Only the owner can reject at this stage');
        }
        if (ts.status !== 'submitted' && ts.status !== 'pending_owner') {
          throw new ValidationError('Only submitted or owner-pending timesheets can be rejected');
        }
        const reason = update.rejection_reason ?? (typeof body.rejection_reason === 'string' ? body.rejection_reason.trim() : '');
        if (!reason) throw new ValidationError('rejection_reason required');
        update.status = 'rejected';
        update.rejection_reason = reason;
        notifyEvent = 'rejected';

      } else if (target === 'draft') {
        if (!isOwnerOfRow) throw new AuthError('forbidden', 'Only the owner can reopen');
        if (ts.status !== 'rejected') throw new ValidationError('Only rejected timesheets can be reopened');
        // Reopen wipes prior signatures + manager action so the part-timer
        // restarts the approval chain from scratch.
        update.status = 'draft';
        update.rejection_reason = null;
        update.employee_signature = null;
        update.manager_signature = null;
        update.manager_action_by = null;
        update.manager_action_at = null;
      }
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
    }

    const updated = await withTx(me.id, async (tx) => {
      const r = await tx.query<TimesheetRow>(
        `UPDATE timesheets SET
           employee_signature = CASE WHEN $1::boolean THEN $2 ELSE employee_signature END,
           manager_signature  = CASE WHEN $3::boolean THEN $4 ELSE manager_signature END,
           comments           = CASE WHEN $5::boolean THEN $6 ELSE comments END,
           status             = COALESCE($7, status),
           rejection_reason   = CASE WHEN $8::boolean THEN $9 ELSE rejection_reason END,
           approved_by        = CASE WHEN $10::boolean THEN $11::uuid ELSE approved_by END,
           approved_at        = CASE WHEN $12::boolean THEN $13::timestamptz ELSE approved_at END,
           manager_action_by  = CASE WHEN $14::boolean THEN $15::uuid ELSE manager_action_by END,
           manager_action_at  = CASE WHEN $16::boolean THEN $17::timestamptz ELSE manager_action_at END,
           updated_at         = NOW()
         WHERE id = $18
         RETURNING ${TS_SELECT}`,
        [
          'employee_signature' in update,
          update.employee_signature ?? null,
          'manager_signature' in update,
          update.manager_signature ?? null,
          'comments' in update,
          update.comments ?? null,
          update.status ?? null,
          'rejection_reason' in update,
          update.rejection_reason ?? null,
          'approved_by' in update,
          update.approved_by ?? null,
          'approved_at' in update,
          update.approved_at ?? null,
          'manager_action_by' in update,
          update.manager_action_by ?? null,
          'manager_action_at' in update,
          update.manager_action_at ?? null,
          id,
        ],
      );
      return r.rows[0];
    });

    // Fire-and-forget notifications (do not block the response).
    if (notifyEvent === 'submitted') {
      notifyTimesheetSubmitted({
        partTimerName: me.full_name,
        monthYear: updated.month_year,
      }).catch(err => console.error('notifyTimesheetSubmitted error:', err));
    } else if (notifyEvent === 'pending_owner') {
      // Look up part-timer name for the message — best-effort.
      sql<{ full_name: string }>`SELECT full_name FROM profiles WHERE id = ${updated.user_id} LIMIT 1`
        .then(({ rows }) => {
          const partTimerName = rows[0]?.full_name ?? 'A part-timer';
          notifyTimesheetForOwner({
            partTimerName,
            managerName: me.full_name,
            monthYear: updated.month_year,
          }).catch(err => console.error('notifyTimesheetForOwner error:', err));
        })
        .catch(err => console.error('notifyTimesheetForOwner lookup error:', err));
    } else if (notifyEvent === 'approved' || notifyEvent === 'rejected') {
      notifyTimesheetDecision({
        partTimerUserId: updated.user_id,
        monthYear: updated.month_year,
        approved: notifyEvent === 'approved',
        rejectionReason: updated.rejection_reason,
      }).catch(err => console.error('notifyTimesheetDecision error:', err));
    }

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
