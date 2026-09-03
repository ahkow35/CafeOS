import { NextResponse, after } from 'next/server';
import { query, withTenantTx, isDbUnavailable } from '@/lib/db';
import { requireTenantUser, requireManagerInCafe, AuthError } from '@/lib/auth';
import { ValidationError, parseMoney } from '@/lib/validators';
import { isValidOwnAttachmentUrl } from '@/lib/storage';
import { todayInSingapore } from '@/lib/dateUtils';
import { notifyClaimSubmitted } from '@/lib/notifications';
import {
  CLAIM_COLUMNS, CLAIM_RETURNING, CLAIM_PROFILE_COLUMNS,
  serialiseClaim, type ClaimRow, type JoinedClaimRow,
} from '@/lib/claims';

export const runtime = 'nodejs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DESCRIPTION = 500;

function parseReceiptDate(input: unknown): string {
  if (typeof input !== 'string' || !DATE_RE.test(input)) {
    throw new ValidationError('receipt_date must be YYYY-MM-DD');
  }
  if (Number.isNaN(Date.parse(input + 'T00:00:00Z'))) {
    throw new ValidationError('receipt_date is not a valid date');
  }
  if (input > todayInSingapore()) throw new ValidationError('receipt_date cannot be in the future');
  return input;
}

function parseDescription(input: unknown): string | null {
  if (input == null) return null;
  if (typeof input !== 'string') throw new ValidationError('description must be text');
  const t = input.trim();
  if (t.length === 0) return null;
  if (t.length > MAX_DESCRIPTION) throw new ValidationError(`description must be at most ${MAX_DESCRIPTION} characters`);
  return t;
}

function errorResponse(e: unknown, where: string): Response {
  if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof AuthError) {
    const status = e.code === 'unauthorized' ? 401 : 403;
    return NextResponse.json({ error: e.message }, { status });
  }
  if (isDbUnavailable(e)) {
    console.error(`claims ${where}: database unavailable`, e);
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  }
  console.error(`claims ${where} error`, e);
  return NextResponse.json({ error: `Failed to ${where === 'GET' ? 'load' : 'create'} claims` }, { status: 500 });
}

/**
 * GET /api/claims?scope=mine|pending|history
 *  - mine    : caller's own claims in this café
 *  - pending : manager+owner — all pending claims (managers read-only; enforced in PATCH)
 *  - history : manager+owner — decided claims; managers see staff/part-timer rows only
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireTenantUser();
    const scope = new URL(req.url).searchParams.get('scope') ?? 'mine';

    if (scope === 'mine') {
      const { rows } = await query<ClaimRow>(
        `SELECT ${CLAIM_RETURNING}
           FROM medical_claims
          WHERE user_id = $1 AND cafe_id = $2
          ORDER BY created_at DESC`,
        [ctx.userId, ctx.cafeId],
      );
      return NextResponse.json({ claims: rows.map(serialiseClaim) });
    }

    if (scope === 'pending' || scope === 'history') {
      requireManagerInCafe(ctx);
      const statuses = scope === 'pending' ? ['pending'] : ['approved', 'rejected'];
      const roles = ctx.role === 'owner'
        ? ['staff', 'manager', 'owner', 'part_timer']
        : ['staff', 'part_timer'];
      const order = scope === 'pending' ? 'ASC' : 'DESC';
      const { rows } = await query<JoinedClaimRow>(
        `SELECT ${CLAIM_COLUMNS}, ${CLAIM_PROFILE_COLUMNS}
           FROM medical_claims c
           JOIN profiles p ON p.id = c.user_id
           JOIN cafe_memberships m ON m.user_id = p.id AND m.cafe_id = c.cafe_id
          WHERE c.cafe_id = $1
            AND c.status = ANY($2::text[])
            AND m.role   = ANY($3::text[])
          ORDER BY c.created_at ${order}`,
        [ctx.cafeId, statuses, roles],
      );
      return NextResponse.json({ claims: rows.map(serialiseClaim) });
    }

    return NextResponse.json({ error: `Unknown scope "${scope}"` }, { status: 400 });
  } catch (e) {
    return errorResponse(e, 'GET');
  }
}

/**
 * POST /api/claims
 * Body: { receipt_date, amount_claimed, description?, receipt_url }
 *  - Rejects if amount exceeds balance minus the sum of the caller's pending claims,
 *    checked under FOR UPDATE on the membership row.
 *  - Owner's own claim: inserted as approved and deducted in the same transaction.
 *  - Otherwise pending; nothing is deducted until approval.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireTenantUser();
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const receipt_date = parseReceiptDate(body.receipt_date);
    const amount = parseMoney(body.amount_claimed, 'Amount');
    const description = parseDescription(body.description);
    const receipt_url = typeof body.receipt_url === 'string' ? body.receipt_url : '';
    if (!receipt_url) throw new ValidationError('A receipt is required');
    if (!isValidOwnAttachmentUrl('claim-receipt', receipt_url, ctx.cafeId, ctx.userId)) {
      throw new ValidationError('Invalid receipt URL');
    }

    const amountParam = amount.toFixed(2);
    const autoApprove = ctx.role === 'owner';

    const { created, requesterName } = await withTenantTx(ctx, async (tx) => {
      const { rows: balRows } = await tx.query<{ full_name: string; medical_claim_balance: string }>(
        `SELECT p.full_name, m.medical_claim_balance
           FROM cafe_memberships m
           JOIN profiles p ON p.id = m.user_id
          WHERE m.user_id = $1 AND m.cafe_id = $2
          FOR UPDATE OF m`,
        [ctx.userId, ctx.cafeId],
      );
      if (balRows.length === 0) throw new AuthError('unauthorized', 'Membership not found');

      // Available = balance − pending (nothing is reserved in the DB; the lock above
      // serialises concurrent submits so two cannot both pass this check).
      const { rows: availRows } = await tx.query<{ available: string; pending: string }>(
        `SELECT (m.medical_claim_balance - COALESCE(SUM(c.amount_claimed), 0))::numeric(10,2) AS available,
                COALESCE(SUM(c.amount_claimed), 0)::numeric(10,2) AS pending
           FROM cafe_memberships m
           LEFT JOIN medical_claims c
             ON c.user_id = m.user_id AND c.cafe_id = m.cafe_id AND c.status = 'pending'
          WHERE m.user_id = $1 AND m.cafe_id = $2
          GROUP BY m.medical_claim_balance`,
        [ctx.userId, ctx.cafeId],
      );
      const available = Number(availRows[0].available);
      const pending = Number(availRows[0].pending);
      if (amount > available) {
        throw new ValidationError(
          `Claim exceeds available balance. Available S$${available.toFixed(2)}` +
          (pending > 0 ? ` (after S$${pending.toFixed(2)} pending).` : '.'),
        );
      }

      const insert = await tx.query<ClaimRow>(
        `INSERT INTO medical_claims
            (cafe_id, user_id, receipt_date, amount_claimed, description, receipt_url,
             status, amount_approved, decided_by, decided_at)
         VALUES ($1, $2, $3, $4, $5, $6,
                 CASE WHEN $7::boolean THEN 'approved' ELSE 'pending' END,
                 CASE WHEN $7::boolean THEN $4::numeric ELSE NULL END,
                 CASE WHEN $7::boolean THEN $2::uuid ELSE NULL END,
                 CASE WHEN $7::boolean THEN NOW() ELSE NULL END)
         RETURNING ${CLAIM_RETURNING}`,
        [ctx.cafeId, ctx.userId, receipt_date, amountParam, description, receipt_url, autoApprove],
      );

      if (autoApprove) {
        await tx.query(
          `UPDATE cafe_memberships SET medical_claim_balance = medical_claim_balance - $1::numeric
            WHERE user_id = $2 AND cafe_id = $3`,
          [amountParam, ctx.userId, ctx.cafeId],
        );
      }
      return { created: insert.rows[0], requesterName: balRows[0].full_name };
    });

    if (created.status === 'pending') {
      const cafeId = ctx.cafeId;
      after(async () => {
        try {
          await notifyClaimSubmitted({ cafeId, requesterName, amount, receiptDate: created.receipt_date });
        } catch (err) {
          console.error('notifyClaimSubmitted error:', err);
        }
      });
    }

    return NextResponse.json({ claim: serialiseClaim(created) }, { status: 201 });
  } catch (e) {
    return errorResponse(e, 'POST');
  }
}
