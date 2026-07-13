import { NextResponse, after } from 'next/server';
import { sql, withTenantTx } from '@/lib/db';
import { requireTenantUser, requireManagerInCafe, AuthError } from '@/lib/auth';
import { ValidationError } from '@/lib/validators';
import { deleteMedicalCert } from '@/lib/storage';
import { notifyLeaveDecision } from '@/lib/notifications';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Raised when a concurrent request already changed the row's state under us. → HTTP 409. */
class RequestConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestConflictError';
  }
}

interface LeaveRow {
  id: string;
  user_id: string;
  leave_type: 'annual' | 'medical';
  start_date: string;
  end_date: string;
  days_requested: number;
  status: 'pending_manager' | 'pending_owner' | 'approved' | 'rejected';
  attachment_url: string | null;
}

async function loadRow(id: string, cafeId: string): Promise<LeaveRow | null> {
  const { rows } = await sql<LeaveRow>`
    SELECT id, user_id, leave_type, start_date, end_date, days_requested, status, attachment_url
      FROM leave_requests
     WHERE id = ${id}
       AND cafe_id = ${cafeId}
     LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * PATCH /api/leave-requests/[id]
 * Body: { action: 'approve' | 'reject' }
 *  - approve: manager -> escalate to owner; owner -> final approve
 *  - reject : restores caller's-target balance, sets rejected with manager OR owner attribution
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenantUser();
    requireManagerInCafe(ctx);
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const action = body.action;
    if (action !== 'approve' && action !== 'reject') {
      throw new ValidationError('action must be "approve" or "reject"');
    }

    const row = await loadRow(id, ctx.cafeId);
    if (!row) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    if (row.status === 'approved' || row.status === 'rejected') {
      return NextResponse.json({ error: `Request already ${row.status}` }, { status: 409 });
    }

    // Managers cannot act on their own requests, and cannot final-approve owner-stage rows.
    if (ctx.role === 'manager') {
      if (row.user_id === ctx.userId) throw new AuthError('forbidden', 'Cannot act on your own request');
      if (row.status !== 'pending_manager') {
        throw new AuthError('forbidden', 'This request is past the manager stage');
      }
    }

    const RETURNING =
      'id, user_id, leave_type, start_date, end_date, days_requested, status, attachment_url';

    const updated = await withTenantTx(ctx, async (tx) => {
      // Lock the row and re-read its status inside the transaction. Two concurrent
      // reject/approve requests serialize here: the second blocks until the first
      // commits, then sees the already-decided status and bails — no double refund.
      const lock = await tx.query<{ status: LeaveRow['status'] }>(
        `SELECT status FROM leave_requests WHERE id = $1 AND cafe_id = $2 FOR UPDATE`,
        [id, ctx.cafeId],
      );
      const current = lock.rows[0];
      if (!current) throw new RequestConflictError('Request not found');
      if (current.status === 'approved' || current.status === 'rejected') {
        throw new RequestConflictError(`Request already ${current.status}`);
      }
      if (ctx.role === 'manager' && current.status !== 'pending_manager') {
        throw new AuthError('forbidden', 'This request is past the manager stage');
      }

      if (action === 'approve') {
        if (ctx.role === 'manager') {
          const r = await tx.query<LeaveRow>(
            `UPDATE leave_requests
                SET status = 'pending_owner',
                    manager_action_by = $1, manager_action_at = NOW(), updated_at = NOW()
              WHERE id = $2 AND cafe_id = $3 AND status = 'pending_manager'
              RETURNING ${RETURNING}`,
            [ctx.userId, id, ctx.cafeId],
          );
          if (!r.rows[0]) throw new RequestConflictError('Request already decided');
          return r.rows[0];
        }
        // owner — final approval (also closes the manager stage if it was skipped)
        const r = await tx.query<LeaveRow>(
          `UPDATE leave_requests
              SET status = 'approved',
                  owner_action_by = $1, owner_action_at = NOW(), updated_at = NOW()
            WHERE id = $2 AND cafe_id = $3 AND status IN ('pending_manager', 'pending_owner')
            RETURNING ${RETURNING}`,
          [ctx.userId, id, ctx.cafeId],
        );
        if (!r.rows[0]) throw new RequestConflictError('Request already decided');
        return r.rows[0];
      }

      // reject: transition the row FIRST; only refund if this request owns the transition.
      const isOwner = ctx.role === 'owner';
      const r = await tx.query<LeaveRow>(
        isOwner
          ? `UPDATE leave_requests
                SET status = 'rejected',
                    owner_action_by = $1, owner_action_at = NOW(), updated_at = NOW()
              WHERE id = $2 AND cafe_id = $3 AND status IN ('pending_manager', 'pending_owner')
              RETURNING ${RETURNING}`
          : `UPDATE leave_requests
                SET status = 'rejected',
                    manager_action_by = $1, manager_action_at = NOW(), updated_at = NOW()
              WHERE id = $2 AND cafe_id = $3 AND status = 'pending_manager'
              RETURNING ${RETURNING}`,
        [ctx.userId, id, ctx.cafeId],
      );
      const rejected = r.rows[0];
      if (!rejected) throw new RequestConflictError('Request already decided');

      // The status transition is ours — now restore the café-scoped balance exactly once.
      const balanceCol = row.leave_type === 'annual' ? 'annual_leave_balance' : 'medical_leave_balance';
      await tx.query(
        `UPDATE cafe_memberships SET ${balanceCol} = ${balanceCol} + $1
          WHERE user_id = $2 AND cafe_id = $3`,
        [row.days_requested, row.user_id, ctx.cafeId],
      );
      return rejected;
    });

    if (updated.status === 'approved' || updated.status === 'rejected') {
      const approved = updated.status === 'approved';
      const cafeId = ctx.cafeId;
      after(async () => {
        try {
          await notifyLeaveDecision({
            cafeId,
            requesterUserId: updated.user_id,
            leaveType: updated.leave_type,
            startDate: updated.start_date,
            endDate: updated.end_date,
            days: updated.days_requested,
            approved,
          });
        } catch (err) {
          console.error('notifyLeaveDecision error:', err);
        }
      });
    }

    // Never hand the raw blob URL back — point at the gated read route instead.
    const request = updated.attachment_url
      ? { ...updated, attachment_url: `/api/leave-requests/${updated.id}/attachment` }
      : updated;
    return NextResponse.json({ request });
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof RequestConflictError) return NextResponse.json({ error: e.message }, { status: 409 });
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('leave-requests PATCH error', e);
    return NextResponse.json({ error: 'Failed to update request' }, { status: 500 });
  }
}

/**
 * DELETE /api/leave-requests/[id]
 *  - Owner of the request may cancel while still pending → restores balance.
 *  - Owner role may delete any pending request → restores balance (admin cancellation).
 *  - Owner role may delete an approved record (purge history) → restores balance.
 *  - Owner role may delete a rejected record (purge history) → no balance change (already restored at rejection).
 *  - Deletes attachment from blob storage best-effort.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenantUser();
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const row = await loadRow(id, ctx.cafeId);
    if (!row) return NextResponse.json({ error: 'Request not found' }, { status: 404 });

    const isOwnRow = row.user_id === ctx.userId;
    const isAdmin = ctx.role === 'owner';
    if (row.status === 'approved' || row.status === 'rejected') {
      // Only owners can purge decided records.
      if (!isAdmin) throw new AuthError('forbidden', 'Cannot delete a decided request');
    } else if (!isOwnRow && !isAdmin) {
      throw new AuthError('forbidden', 'Cannot delete this request');
    }

    await withTenantTx(ctx, async (tx) => {
      // Lock + re-read status inside the tx so concurrent deletes can't both refund.
      const lock = await tx.query<{
        status: LeaveRow['status'];
        leave_type: LeaveRow['leave_type'];
        days_requested: number;
        user_id: string;
      }>(
        `SELECT status, leave_type, days_requested, user_id
           FROM leave_requests WHERE id = $1 AND cafe_id = $2 FOR UPDATE`,
        [id, ctx.cafeId],
      );
      const cur = lock.rows[0];
      if (!cur) throw new RequestConflictError('Request not found');

      const refundsBalance =
        cur.status === 'pending_manager' ||
        cur.status === 'pending_owner' ||
        cur.status === 'approved';

      const del = await tx.query(`DELETE FROM leave_requests WHERE id = $1 AND cafe_id = $2`, [id, ctx.cafeId]);
      if (del.rowCount === 1 && refundsBalance) {
        const balanceCol = cur.leave_type === 'annual' ? 'annual_leave_balance' : 'medical_leave_balance';
        await tx.query(
          `UPDATE cafe_memberships SET ${balanceCol} = ${balanceCol} + $1
            WHERE user_id = $2 AND cafe_id = $3`,
          [cur.days_requested, cur.user_id, ctx.cafeId],
        );
      }
    });

    if (row.attachment_url) {
      deleteMedicalCert(row.attachment_url).catch(err =>
        console.error('blob cleanup failed', err),
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof RequestConflictError) return NextResponse.json({ error: e.message }, { status: 409 });
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('leave-requests DELETE error', e);
    return NextResponse.json({ error: 'Failed to delete request' }, { status: 500 });
  }
}
