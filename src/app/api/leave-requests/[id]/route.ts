import { NextResponse } from 'next/server';
import { sql, withTx } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/auth';
import { ValidationError } from '@/lib/validators';
import { deleteMedicalCert } from '@/lib/storage';
import { notifyLeaveDecision } from '@/lib/notifications';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

async function loadRow(id: string): Promise<LeaveRow | null> {
  const { rows } = await sql<LeaveRow>`
    SELECT id, user_id, leave_type, start_date, end_date, days_requested, status, attachment_url
      FROM leave_requests
     WHERE id = ${id}
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
    const me = await requireUser();
    if (me.role !== 'manager' && me.role !== 'owner') {
      throw new AuthError('forbidden', 'Manager or owner access required');
    }
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

    const row = await loadRow(id);
    if (!row) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    if (row.status === 'approved' || row.status === 'rejected') {
      return NextResponse.json({ error: `Request already ${row.status}` }, { status: 409 });
    }

    // Managers cannot act on their own requests, and cannot final-approve owner-stage rows.
    if (me.role === 'manager') {
      if (row.user_id === me.id) throw new AuthError('forbidden', 'Cannot act on your own request');
      if (row.status !== 'pending_manager') {
        throw new AuthError('forbidden', 'This request is past the manager stage');
      }
    }

    const updated = await withTx(me.id, async (tx) => {
      if (action === 'approve') {
        if (me.role === 'manager') {
          const r = await tx.query<LeaveRow>(
            `UPDATE leave_requests
                SET status = 'pending_owner',
                    manager_action_by = $1,
                    manager_action_at = NOW(),
                    updated_at = NOW()
              WHERE id = $2
              RETURNING id, user_id, leave_type, start_date, end_date, days_requested, status, attachment_url`,
            [me.id, id],
          );
          return r.rows[0];
        }
        // owner — final approval (also closes the manager stage if it was skipped)
        const r = await tx.query<LeaveRow>(
          `UPDATE leave_requests
              SET status = 'approved',
                  owner_action_by = $1,
                  owner_action_at = NOW(),
                  updated_at = NOW()
            WHERE id = $2
            RETURNING id, user_id, leave_type, start_date, end_date, days_requested, status, attachment_url`,
          [me.id, id],
        );
        return r.rows[0];
      }

      // reject: restore balance + mark rejected
      const balanceCol = row.leave_type === 'annual' ? 'annual_leave_balance' : 'medical_leave_balance';
      await tx.query(
        `UPDATE profiles SET ${balanceCol} = ${balanceCol} + $1, updated_at = NOW() WHERE id = $2`,
        [row.days_requested, row.user_id],
      );
      const isOwner = me.role === 'owner';
      const r = await tx.query<LeaveRow>(
        isOwner
          ? `UPDATE leave_requests
                SET status = 'rejected',
                    owner_action_by = $1, owner_action_at = NOW(),
                    updated_at = NOW()
              WHERE id = $2
              RETURNING id, user_id, leave_type, start_date, end_date, days_requested, status, attachment_url`
          : `UPDATE leave_requests
                SET status = 'rejected',
                    manager_action_by = $1, manager_action_at = NOW(),
                    updated_at = NOW()
              WHERE id = $2
              RETURNING id, user_id, leave_type, start_date, end_date, days_requested, status, attachment_url`,
        [me.id, id],
      );
      return r.rows[0];
    });

    // Notify requester on final decisions (approved or rejected)
    if (updated.status === 'approved' || updated.status === 'rejected') {
      notifyLeaveDecision({
        requesterUserId: updated.user_id,
        leaveType: updated.leave_type,
        startDate: updated.start_date,
        endDate: updated.end_date,
        days: updated.days_requested,
        approved: updated.status === 'approved',
      }).catch(err => console.error('notifyLeaveDecision error:', err));
    }

    return NextResponse.json({ request: updated });
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
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
    const me = await requireUser();
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const row = await loadRow(id);
    if (!row) return NextResponse.json({ error: 'Request not found' }, { status: 404 });

    const isOwnRow = row.user_id === me.id;
    const isAdmin = me.role === 'owner';
    if (row.status === 'approved' || row.status === 'rejected') {
      // Only owners can purge decided records.
      if (!isAdmin) throw new AuthError('forbidden', 'Cannot delete a decided request');
    } else if (!isOwnRow && !isAdmin) {
      throw new AuthError('forbidden', 'Cannot delete this request');
    }

    const refundsBalance =
      row.status === 'pending_manager' ||
      row.status === 'pending_owner' ||
      row.status === 'approved';

    await withTx(me.id, async (tx) => {
      if (refundsBalance) {
        const balanceCol = row.leave_type === 'annual' ? 'annual_leave_balance' : 'medical_leave_balance';
        await tx.query(
          `UPDATE profiles SET ${balanceCol} = ${balanceCol} + $1, updated_at = NOW() WHERE id = $2`,
          [row.days_requested, row.user_id],
        );
      }
      await tx.query(`DELETE FROM leave_requests WHERE id = $1`, [id]);
    });

    if (row.attachment_url) {
      deleteMedicalCert(row.attachment_url).catch(err =>
        console.error('blob cleanup failed', err),
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('leave-requests DELETE error', e);
    return NextResponse.json({ error: 'Failed to delete request' }, { status: 500 });
  }
}
