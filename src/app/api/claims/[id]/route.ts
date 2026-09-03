import { NextResponse, after } from 'next/server';
import { query, withTenantTx, isDbUnavailable } from '@/lib/db';
import { requireTenantUser, requireOwnerInCafe, AuthError } from '@/lib/auth';
import { ValidationError, parseMoney } from '@/lib/validators';
import { deleteAttachment } from '@/lib/storage';
import { notifyClaimDecision } from '@/lib/notifications';
import { CLAIM_RETURNING, RequestConflictError, serialiseClaim, type ClaimRow } from '@/lib/claims';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NOTE = 500;

async function loadRow(id: string, cafeId: string): Promise<ClaimRow | null> {
  const { rows } = await query<ClaimRow>(
    `SELECT ${CLAIM_RETURNING} FROM medical_claims WHERE id = $1 AND cafe_id = $2 LIMIT 1`,
    [id, cafeId],
  );
  return rows[0] ?? null;
}

function errorResponse(e: unknown, where: string): Response {
  if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof RequestConflictError) return NextResponse.json({ error: e.message }, { status: 409 });
  if (e instanceof AuthError) {
    const status = e.code === 'unauthorized' ? 401 : 403;
    return NextResponse.json({ error: e.message }, { status });
  }
  if (isDbUnavailable(e)) {
    console.error(`claims/[id] ${where}: database unavailable`, e);
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  }
  console.error(`claims/[id] ${where} error`, e);
  return NextResponse.json({ error: 'Failed to update claim' }, { status: 500 });
}

/**
 * PATCH /api/claims/[id]  (owner only)
 * Body: { action: 'approve', amount_approved? } | { action: 'reject', note? }
 *  - approve: amount defaults to amount_claimed, must be ≤ it and ≤ current balance;
 *             deducts the approved amount from the claimant's membership.
 *  - reject : status only, optional note. No balance change.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenantUser();
    requireOwnerInCafe(ctx);
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
    if (!row) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    if (row.status !== 'pending') {
      return NextResponse.json({ error: `Claim already ${row.status}` }, { status: 409 });
    }

    let note: string | null = null;
    if (action === 'reject' && body.note != null) {
      if (typeof body.note !== 'string') throw new ValidationError('note must be text');
      note = body.note.trim() || null;
      if (note && note.length > MAX_NOTE) throw new ValidationError(`note must be at most ${MAX_NOTE} characters`);
    }

    const claimed = Number(row.amount_claimed);
    const approvedAmount = action === 'approve'
      ? (body.amount_approved == null ? claimed : parseMoney(body.amount_approved, 'Approved amount'))
      : null;
    if (approvedAmount !== null && approvedAmount > claimed) {
      throw new ValidationError(`Approved amount cannot exceed the claimed S$${claimed.toFixed(2)}`);
    }

    const updated = await withTenantTx(ctx, async (tx) => {
      // Lock the claim and re-read status: two concurrent decisions serialise here.
      const lock = await tx.query<{ status: ClaimRow['status']; user_id: string }>(
        `SELECT status, user_id FROM medical_claims WHERE id = $1 AND cafe_id = $2 FOR UPDATE`,
        [id, ctx.cafeId],
      );
      const cur = lock.rows[0];
      if (!cur) throw new RequestConflictError('Claim not found');
      if (cur.status !== 'pending') throw new RequestConflictError(`Claim already ${cur.status}`);

      if (action === 'approve') {
        const amountParam = approvedAmount!.toFixed(2);
        // Lock the claimant's membership and re-check the balance: the owner may have
        // edited the cap since submission.
        const bal = await tx.query<{ medical_claim_balance: string }>(
          `SELECT medical_claim_balance FROM cafe_memberships
            WHERE user_id = $1 AND cafe_id = $2 FOR UPDATE`,
          [cur.user_id, ctx.cafeId],
        );
        if (!bal.rows[0]) throw new RequestConflictError('Claimant is no longer a member');
        const balance = Number(bal.rows[0].medical_claim_balance);
        if (approvedAmount! > balance) {
          throw new ValidationError(
            `Balance is S$${balance.toFixed(2)}; cannot approve S$${amountParam}. Lower the amount or raise the cap.`,
          );
        }
        const r = await tx.query<ClaimRow>(
          `UPDATE medical_claims
              SET status = 'approved', amount_approved = $1::numeric,
                  decided_by = $2, decided_at = NOW(), decision_note = NULL
            WHERE id = $3 AND cafe_id = $4 AND status = 'pending'
            RETURNING ${CLAIM_RETURNING}`,
          [amountParam, ctx.userId, id, ctx.cafeId],
        );
        if (!r.rows[0]) throw new RequestConflictError('Claim already decided');
        await tx.query(
          `UPDATE cafe_memberships SET medical_claim_balance = medical_claim_balance - $1::numeric
            WHERE user_id = $2 AND cafe_id = $3`,
          [amountParam, cur.user_id, ctx.cafeId],
        );
        return r.rows[0];
      }

      const r = await tx.query<ClaimRow>(
        `UPDATE medical_claims
            SET status = 'rejected', decided_by = $1, decided_at = NOW(), decision_note = $2
          WHERE id = $3 AND cafe_id = $4 AND status = 'pending'
          RETURNING ${CLAIM_RETURNING}`,
        [ctx.userId, note, id, ctx.cafeId],
      );
      if (!r.rows[0]) throw new RequestConflictError('Claim already decided');
      return r.rows[0];
    });

    const cafeId = ctx.cafeId;
    after(async () => {
      try {
        await notifyClaimDecision({
          cafeId,
          requesterUserId: updated.user_id,
          amountClaimed: Number(updated.amount_claimed),
          amountApproved: updated.amount_approved === null ? null : Number(updated.amount_approved),
          approved: updated.status === 'approved',
          note: updated.decision_note,
        });
      } catch (err) {
        console.error('notifyClaimDecision error:', err);
      }
    });

    return NextResponse.json({ claim: serialiseClaim(updated) });
  } catch (e) {
    return errorResponse(e, 'PATCH');
  }
}

/**
 * DELETE /api/claims/[id]
 *  - Claimant may cancel their own PENDING claim (no balance change).
 *  - Owner may delete any pending claim (no balance change) or purge a decided one;
 *    purging an APPROVED claim refunds amount_approved.
 *  - Receipt blob removed best-effort after commit.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenantUser();
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const row = await loadRow(id, ctx.cafeId);
    if (!row) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });

    const isOwnRow = row.user_id === ctx.userId;
    const isOwner = ctx.role === 'owner';
    if (!isOwner) {
      if (!isOwnRow) throw new AuthError('forbidden', 'Cannot delete this claim');
      if (row.status !== 'pending') throw new AuthError('forbidden', 'Cannot delete a decided claim');
    }

    await withTenantTx(ctx, async (tx) => {
      const lock = await tx.query<{ status: ClaimRow['status']; amount_approved: string | null; user_id: string }>(
        `SELECT status, amount_approved, user_id FROM medical_claims
          WHERE id = $1 AND cafe_id = $2 FOR UPDATE`,
        [id, ctx.cafeId],
      );
      const cur = lock.rows[0];
      if (!cur) throw new RequestConflictError('Claim not found');
      if (!isOwner && cur.status !== 'pending') throw new RequestConflictError(`Claim already ${cur.status}`);

      const del = await tx.query(`DELETE FROM medical_claims WHERE id = $1 AND cafe_id = $2`, [id, ctx.cafeId]);
      if (del.rowCount === 1 && cur.status === 'approved' && cur.amount_approved !== null) {
        await tx.query(
          `UPDATE cafe_memberships SET medical_claim_balance = medical_claim_balance + $1::numeric
            WHERE user_id = $2 AND cafe_id = $3`,
          [cur.amount_approved, cur.user_id, ctx.cafeId],
        );
      }
    });

    deleteAttachment(row.receipt_url).catch((err) => console.error('blob cleanup failed', err));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e, 'DELETE');
  }
}
