import type { MedicalClaim, ClaimStatus, UserRole } from '@/lib/database.types';
import { toMoney, toMoneyOrNull } from '@/lib/money';

/** Raised when a concurrent request already changed the row's state under us. → HTTP 409. */
export class RequestConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestConflictError';
  }
}

/** Raw row as returned by @vercel/postgres — NUMERIC columns are strings. */
export interface ClaimRow {
  id: string;
  user_id: string;
  receipt_date: string;
  amount_claimed: string;
  amount_approved: string | null;
  description: string | null;
  receipt_url: string;
  status: ClaimStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface JoinedClaimRow extends ClaimRow {
  profile_full_name: string;
  profile_role: UserRole;
  profile_claim_balance: string;
}

const COLS = [
  'id', 'user_id', 'receipt_date', 'amount_claimed', 'amount_approved', 'description',
  'receipt_url', 'status', 'decided_by', 'decided_at', 'decision_note', 'created_at', 'updated_at',
];

// The driver (@vercel/postgres / @neondatabase/serverless) parses Postgres DATE
// columns into JS Date objects, not strings — cast receipt_date to text so it
// stays a string end-to-end (matches the entry_date::text pattern used for
// timesheets in src/app/api/timesheets/[id]/route.ts).
const render = (c: string, prefix = ''): string =>
  c === 'receipt_date' ? `${prefix}receipt_date::text AS receipt_date` : `${prefix}${c}`;

/** Column list for SELECTs where medical_claims is aliased `c`. */
export const CLAIM_COLUMNS = COLS.map((c) => render(c, 'c.')).join(', ');
/** Column list for RETURNING / unaliased SELECTs. */
export const CLAIM_RETURNING = COLS.map((c) => render(c)).join(', ');

/** Joined profile columns (profiles aliased `p`, cafe_memberships aliased `m`). */
export const CLAIM_PROFILE_COLUMNS =
  'p.full_name AS profile_full_name, m.role AS profile_role, m.medical_claim_balance AS profile_claim_balance';

function isJoined(r: ClaimRow | JoinedClaimRow): r is JoinedClaimRow {
  return 'profile_full_name' in r;
}

/**
 * Convert a DB row to the API shape: money as numbers and the raw Blob URL
 * replaced by the gated read route so the durable public URL never reaches a client.
 */
export function serialiseClaim(r: ClaimRow | JoinedClaimRow): MedicalClaim {
  const out: MedicalClaim = {
    id: r.id,
    user_id: r.user_id,
    receipt_date: r.receipt_date,
    amount_claimed: toMoney(r.amount_claimed),
    amount_approved: toMoneyOrNull(r.amount_approved),
    description: r.description,
    receipt_url: `/api/claims/${r.id}/receipt`,
    status: r.status,
    decided_by: r.decided_by,
    decided_at: r.decided_at,
    decision_note: r.decision_note,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
  if (isJoined(r)) {
    out.profile = {
      full_name: r.profile_full_name,
      role: r.profile_role,
      medical_claim_balance: toMoney(r.profile_claim_balance),
    };
  }
  return out;
}
