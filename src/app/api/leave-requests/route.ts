import { NextResponse, after } from 'next/server';
import { sql, withTenantTx } from '@/lib/db';
import { requireTenantUser, requireManagerInCafe, AuthError } from '@/lib/auth';
import { ValidationError } from '@/lib/validators';
import { notifyLeaveSubmitted } from '@/lib/notifications';

export const runtime = 'nodejs';

const LEAVE_TYPES = ['annual', 'medical'] as const;
type LeaveType = (typeof LEAVE_TYPES)[number];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface LeaveRow {
  id: string;
  user_id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  days_requested: number;
  reason: string | null;
  attachment_url: string | null;
  is_retrospective: boolean;
  status: 'pending_manager' | 'pending_owner' | 'approved' | 'rejected';
  manager_action_by: string | null;
  manager_action_at: string | null;
  owner_action_by: string | null;
  owner_action_at: string | null;
  created_at: string;
  updated_at: string;
}

interface JoinedLeaveRow extends LeaveRow {
  profile_full_name: string;
  profile_phone_e164: string;
  profile_role: 'staff' | 'manager' | 'owner' | 'part_timer';
  profile_annual_balance: number;
  profile_medical_balance: number;
}

/**
 * Replace the raw Vercel Blob URL with the gated read route so the durable
 * public URL never reaches a client. Reads go through /api/leave-requests/[id]/attachment.
 */
function gateAttachment<T extends { id: string; attachment_url: string | null }>(r: T): T {
  return r.attachment_url
    ? { ...r, attachment_url: `/api/leave-requests/${r.id}/attachment` }
    : r;
}

function parseLeaveType(input: unknown): LeaveType {
  if (typeof input !== 'string' || !LEAVE_TYPES.includes(input as LeaveType)) {
    throw new ValidationError('leave_type must be "annual" or "medical"');
  }
  return input as LeaveType;
}

function parseDate(input: unknown, label: string): string {
  if (typeof input !== 'string' || !DATE_RE.test(input)) {
    throw new ValidationError(`${label} must be YYYY-MM-DD`);
  }
  // sanity-check parseability
  if (Number.isNaN(Date.parse(input + 'T00:00:00Z'))) {
    throw new ValidationError(`${label} is not a valid date`);
  }
  return input;
}

function daysBetween(startISO: string, endISO: string): number {
  const start = new Date(startISO + 'T12:00:00Z').getTime();
  const end = new Date(endISO + 'T12:00:00Z').getTime();
  if (end < start) return 0;
  return Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * GET /api/leave-requests?scope=mine|pending|history|all
 *  - mine    : caller's own requests
 *  - pending : manager+owner queue (filtered server-side by caller's role)
 *  - history : manager+owner archive (approved/rejected only; manager sees only staff records)
 *  - all     : owner-only full list
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireTenantUser();
    const url = new URL(req.url);
    const scope = url.searchParams.get('scope') ?? 'mine';

    if (scope === 'mine') {
      const { rows } = await sql<LeaveRow>`
        SELECT id, user_id, leave_type, start_date, end_date, days_requested,
               reason, attachment_url, is_retrospective, status,
               manager_action_by, manager_action_at, owner_action_by, owner_action_at,
               created_at, updated_at
          FROM leave_requests
         WHERE user_id = ${ctx.userId}
           AND cafe_id = ${ctx.cafeId}
         ORDER BY created_at DESC
      `;
      return NextResponse.json({ requests: rows.map(gateAttachment) });
    }

    if (scope === 'pending') {
      requireManagerInCafe(ctx);
      // Owners see both pending stages (they can approve directly).
      // Managers only see pending_manager and never their own requests.
      const { rows } = ctx.role === 'owner'
        ? await sql<JoinedLeaveRow>`
            SELECT lr.id, lr.user_id, lr.leave_type, lr.start_date, lr.end_date,
                   lr.days_requested, lr.reason, lr.attachment_url, lr.is_retrospective,
                   lr.status, lr.manager_action_by, lr.manager_action_at,
                   lr.owner_action_by, lr.owner_action_at, lr.created_at, lr.updated_at,
                   p.full_name AS profile_full_name, p.phone_e164 AS profile_phone_e164,
                   m.role AS profile_role,
                   m.annual_leave_balance AS profile_annual_balance,
                   m.medical_leave_balance AS profile_medical_balance
              FROM leave_requests lr
              JOIN profiles p ON p.id = lr.user_id
              JOIN cafe_memberships m ON m.user_id = p.id AND m.cafe_id = lr.cafe_id
             WHERE lr.status IN ('pending_manager','pending_owner')
               AND lr.cafe_id = ${ctx.cafeId}
             ORDER BY lr.created_at ASC
          `
        : await sql<JoinedLeaveRow>`
            SELECT lr.id, lr.user_id, lr.leave_type, lr.start_date, lr.end_date,
                   lr.days_requested, lr.reason, lr.attachment_url, lr.is_retrospective,
                   lr.status, lr.manager_action_by, lr.manager_action_at,
                   lr.owner_action_by, lr.owner_action_at, lr.created_at, lr.updated_at,
                   p.full_name AS profile_full_name, p.phone_e164 AS profile_phone_e164,
                   m.role AS profile_role,
                   m.annual_leave_balance AS profile_annual_balance,
                   m.medical_leave_balance AS profile_medical_balance
              FROM leave_requests lr
              JOIN profiles p ON p.id = lr.user_id
              JOIN cafe_memberships m ON m.user_id = p.id AND m.cafe_id = lr.cafe_id
             WHERE lr.status = 'pending_manager'
               AND lr.cafe_id = ${ctx.cafeId}
               AND lr.user_id <> ${ctx.userId}
             ORDER BY lr.created_at ASC
          `;
      return NextResponse.json({
        requests: rows.map((r: JoinedLeaveRow) => ({
          ...gateAttachment(r),
          profile: {
            full_name: r.profile_full_name,
            phone_e164: r.profile_phone_e164,
            role: r.profile_role,
            annual_leave_balance: r.profile_annual_balance,
            medical_leave_balance: r.profile_medical_balance,
          },
        })),
      });
    }

    if (scope === 'history') {
      requireManagerInCafe(ctx);
      const { rows } = ctx.role === 'owner'
        ? await sql<JoinedLeaveRow>`
            SELECT lr.id, lr.user_id, lr.leave_type, lr.start_date, lr.end_date,
                   lr.days_requested, lr.reason, lr.attachment_url, lr.is_retrospective,
                   lr.status, lr.manager_action_by, lr.manager_action_at,
                   lr.owner_action_by, lr.owner_action_at, lr.created_at, lr.updated_at,
                   p.full_name AS profile_full_name, p.phone_e164 AS profile_phone_e164,
                   m.role AS profile_role,
                   m.annual_leave_balance AS profile_annual_balance,
                   m.medical_leave_balance AS profile_medical_balance
              FROM leave_requests lr
              JOIN profiles p ON p.id = lr.user_id
              JOIN cafe_memberships m ON m.user_id = p.id AND m.cafe_id = lr.cafe_id
             WHERE lr.status IN ('approved','rejected')
               AND lr.cafe_id = ${ctx.cafeId}
             ORDER BY lr.created_at DESC
          `
        : await sql<JoinedLeaveRow>`
            SELECT lr.id, lr.user_id, lr.leave_type, lr.start_date, lr.end_date,
                   lr.days_requested, lr.reason, lr.attachment_url, lr.is_retrospective,
                   lr.status, lr.manager_action_by, lr.manager_action_at,
                   lr.owner_action_by, lr.owner_action_at, lr.created_at, lr.updated_at,
                   p.full_name AS profile_full_name, p.phone_e164 AS profile_phone_e164,
                   m.role AS profile_role,
                   m.annual_leave_balance AS profile_annual_balance,
                   m.medical_leave_balance AS profile_medical_balance
              FROM leave_requests lr
              JOIN profiles p ON p.id = lr.user_id
              JOIN cafe_memberships m ON m.user_id = p.id AND m.cafe_id = lr.cafe_id
             WHERE lr.status IN ('approved','rejected')
               AND lr.cafe_id = ${ctx.cafeId}
               AND m.role IN ('staff','part_timer')
             ORDER BY lr.created_at DESC
          `;
      return NextResponse.json({
        requests: rows.map((r: JoinedLeaveRow) => ({
          ...gateAttachment(r),
          profile: {
            full_name: r.profile_full_name,
            phone_e164: r.profile_phone_e164,
            role: r.profile_role,
            annual_leave_balance: r.profile_annual_balance,
            medical_leave_balance: r.profile_medical_balance,
          },
        })),
      });
    }

    if (scope === 'all') {
      requireManagerInCafe(ctx);
      if (ctx.role !== 'owner') throw new AuthError('forbidden', 'Owner access required');
      const { rows } = await sql<JoinedLeaveRow>`
        SELECT lr.id, lr.user_id, lr.leave_type, lr.start_date, lr.end_date,
               lr.days_requested, lr.reason, lr.attachment_url, lr.is_retrospective,
               lr.status, lr.manager_action_by, lr.manager_action_at,
               lr.owner_action_by, lr.owner_action_at, lr.created_at, lr.updated_at,
               p.full_name AS profile_full_name, p.phone_e164 AS profile_phone_e164,
               m.role AS profile_role,
               m.annual_leave_balance AS profile_annual_balance,
               m.medical_leave_balance AS profile_medical_balance
          FROM leave_requests lr
          JOIN profiles p ON p.id = lr.user_id
          JOIN cafe_memberships m ON m.user_id = p.id AND m.cafe_id = lr.cafe_id
         WHERE lr.cafe_id = ${ctx.cafeId}
         ORDER BY lr.created_at DESC
      `;
      return NextResponse.json({
        requests: rows.map((r: JoinedLeaveRow) => ({
          ...gateAttachment(r),
          profile: {
            full_name: r.profile_full_name,
            phone_e164: r.profile_phone_e164,
            role: r.profile_role,
            annual_leave_balance: r.profile_annual_balance,
            medical_leave_balance: r.profile_medical_balance,
          },
        })),
      });
    }

    return NextResponse.json({ error: `Unknown scope "${scope}"` }, { status: 400 });
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('leave-requests GET error', e);
    return NextResponse.json({ error: 'Failed to load leave requests' }, { status: 500 });
  }
}

/**
 * POST /api/leave-requests
 * Body: { leave_type, start_date, end_date, reason?, attachment_url? }
 * Behaviour:
 *  - Computes days_requested server-side.
 *  - Checks for overlap against caller's existing pending/approved requests.
 *  - Deducts caller's balance atomically with the insert.
 *  - Initial status: staff -> pending_manager, manager -> pending_owner, owner -> approved.
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

    const leave_type = parseLeaveType(body.leave_type);
    const start_date = parseDate(body.start_date, 'start_date');
    const end_date = parseDate(body.end_date, 'end_date');
    const days = daysBetween(start_date, end_date);
    if (days <= 0) throw new ValidationError('end_date must be on or after start_date');

    const reason = leave_type === 'medical'
      ? (typeof body.reason === 'string' && body.reason.trim().length > 0 ? body.reason.trim() : null)
      : null;
    if (leave_type === 'medical' && !reason) throw new ValidationError('Reason required for medical leave');

    const attachment_url = body.attachment_url == null
      ? null
      : (typeof body.attachment_url === 'string' && body.attachment_url.length > 0 ? body.attachment_url : null);
    if (leave_type === 'medical' && !attachment_url) {
      throw new ValidationError('Medical certificate attachment required for medical leave');
    }

    // Validate attachment_url belongs to this user/cafe — prevents referencing
    // another user's blob or arbitrary external URLs.
    if (leave_type === 'medical' && attachment_url) {
      try {
        const { pathname } = new URL(attachment_url);
        if (!pathname.startsWith(`/medical-certificates/${ctx.cafeId}/${ctx.userId}/`)) {
          throw new ValidationError('Invalid attachment URL');
        }
      } catch (e) {
        if (e instanceof ValidationError) throw e;
        throw new ValidationError('Invalid attachment URL');
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const is_retrospective = start_date < today;

    const initialStatus =
      ctx.role === 'owner' ? 'approved' :
      ctx.role === 'manager' ? 'pending_owner' : 'pending_manager';

    const balanceCol = leave_type === 'annual' ? 'annual_leave_balance' : 'medical_leave_balance';

    // All checks run inside the transaction with a FOR UPDATE lock on the caller's
    // membership row (café-scoped balances live there now). This serializes
    // concurrent submissions for the same user, preventing overdraw and overlaps.
    const { created, requesterName } = await withTenantTx(ctx, async (tx) => {
      const { rows: balRows } = await tx.query<{
        full_name: string;
        annual_leave_balance: number;
        medical_leave_balance: number;
      }>(
        `SELECT p.full_name, m.annual_leave_balance, m.medical_leave_balance
           FROM cafe_memberships m
           JOIN profiles p ON p.id = m.user_id
          WHERE m.user_id = $1 AND m.cafe_id = $2
          FOR UPDATE OF m`,
        [ctx.userId, ctx.cafeId],
      );
      if (balRows.length === 0) throw new AuthError('unauthorized', 'Membership not found');
      const balRow = balRows[0];

      const currentBalance = leave_type === 'annual'
        ? balRow.annual_leave_balance
        : balRow.medical_leave_balance;
      if (days > currentBalance) {
        throw new ValidationError(
          `Insufficient ${leave_type} leave balance. Requested ${days}, available ${currentBalance}.`,
        );
      }

      // Overlap check — serialized by the FOR UPDATE lock.
      const { rows: overlap } = await tx.query<{
        start_date: string; end_date: string; leave_type: LeaveType; status: string;
      }>(
        `SELECT start_date, end_date, leave_type, status
           FROM leave_requests
          WHERE user_id = $1 AND cafe_id = $2
            AND status IN ('pending_manager','pending_owner','approved')
            AND start_date <= $3::date AND end_date >= $4::date
          LIMIT 1`,
        [ctx.userId, ctx.cafeId, end_date, start_date],
      );
      if (overlap.length > 0) {
        const o = overlap[0];
        throw new ValidationError(
          `Overlaps with existing ${o.leave_type} request (${o.status}) ${o.start_date} – ${o.end_date}.`,
        );
      }

      await tx.query(
        `UPDATE cafe_memberships SET ${balanceCol} = ${balanceCol} - $1
          WHERE user_id = $2 AND cafe_id = $3`,
        [days, ctx.userId, ctx.cafeId],
      );

      const insert = await tx.query<LeaveRow>(
        `INSERT INTO leave_requests
            (cafe_id, user_id, leave_type, start_date, end_date, days_requested,
             reason, attachment_url, is_retrospective, status,
             owner_action_by, owner_action_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                  CASE WHEN $10 = 'approved' THEN $2::uuid ELSE NULL END,
                  CASE WHEN $10 = 'approved' THEN NOW() ELSE NULL END)
          RETURNING id, user_id, leave_type, start_date, end_date, days_requested,
                    reason, attachment_url, is_retrospective, status,
                    manager_action_by, manager_action_at, owner_action_by, owner_action_at,
                    created_at, updated_at`,
        [ctx.cafeId, ctx.userId, leave_type, start_date, end_date, days, reason, attachment_url, is_retrospective, initialStatus],
      );
      return { created: insert.rows[0], requesterName: balRow.full_name };
    });

    if (created.status !== 'approved') {
      const cafeId = ctx.cafeId;
      after(async () => {
        try {
          await notifyLeaveSubmitted({
            cafeId,
            requesterName,
            leaveType: created.leave_type,
            startDate: created.start_date,
            endDate: created.end_date,
            days: created.days_requested,
          });
        } catch (err) {
          console.error('notifyLeaveSubmitted error:', err);
        }
      });
    }

    return NextResponse.json({ request: gateAttachment(created) }, { status: 201 });
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('leave-requests POST error', e);
    return NextResponse.json({ error: 'Failed to create leave request' }, { status: 500 });
  }
}
