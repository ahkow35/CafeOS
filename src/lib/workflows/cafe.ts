export const CAFE_STATUSES = ['pending', 'active', 'suspended'] as const;
export type CafeStatus = (typeof CAFE_STATUSES)[number];

/** What a super admin can do to a cafe. Rejecting removes the cafe, so it has no status to move to. */
export type CafeAction = 'approve' | 'reject' | 'suspend';

export interface CafeMove {
  action: CafeAction;
  /** The statuses the action may be taken from. */
  from: readonly CafeStatus[];
  /** The status the cafe ends up in; null when the cafe is removed. */
  to: CafeStatus | null;
}

/**
 * Super-admin moves on a cafe (the actor is always a super admin, checked by the
 * route before anything else). Approving and rejecting are for pending cafes only;
 * suspending is for every cafe except a pending one, so a cafe that is already
 * suspended can be given the admin stamp.
 */
export const CAFE_MOVES: readonly CafeMove[] = [
  { action: 'approve', from: ['pending'], to: 'active' },
  { action: 'reject', from: ['pending'], to: null },
  { action: 'suspend', from: ['active', 'suspended'], to: 'suspended' },
];

export type CafeMoveDecision = { ok: true } | { ok: false; reason: 'wrong_status' };

export function decideCafeMove(from: CafeStatus, action: CafeAction): CafeMoveDecision {
  const move = CAFE_MOVES.find((m) => m.action === action);
  return move && move.from.includes(from) ? { ok: true } : { ok: false, reason: 'wrong_status' };
}

/** The moves open to a super admin on a cafe in this status. */
export function cafeActionsFor(from: CafeStatus): CafeMove[] {
  return CAFE_MOVES.filter((m) => m.from.includes(from));
}
