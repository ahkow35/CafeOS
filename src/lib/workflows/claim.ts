import { actorMay, type ActorKind, type WorkflowActor } from './actor';

export const CLAIM_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export interface ClaimMove {
  from: ClaimStatus;
  to: ClaimStatus;
  /** Any one of these kinds of actor may make the move. */
  who: readonly ActorKind[];
}

/** Only the owner decides a medical claim, and only while it is pending. */
export const CLAIM_MOVES: readonly ClaimMove[] = [
  { from: 'pending', to: 'approved', who: ['owner'] },
  { from: 'pending', to: 'rejected', who: ['owner'] },
];

/**
 * - not_permitted: the actor may not decide a claim
 * - already_decided: the claim is no longer pending
 */
export type ClaimMoveDecision = { ok: true } | { ok: false; reason: 'not_permitted' | 'already_decided' };

/** The actor check comes before the status check, as the route has always answered. */
export function decideClaimMove(from: ClaimStatus, to: ClaimStatus, actor: WorkflowActor): ClaimMoveDecision {
  const towards = CLAIM_MOVES.filter((m) => m.to === to);
  if (!towards.some((m) => actorMay(m.who, actor))) return { ok: false, reason: 'not_permitted' };
  if (!towards.some((m) => m.from === from)) return { ok: false, reason: 'already_decided' };
  return { ok: true };
}

/** The moves from `from` that are open to this actor. */
export function claimActionsFor(from: ClaimStatus, actor: WorkflowActor): ClaimMove[] {
  return CLAIM_MOVES.filter((m) => m.from === from && actorMay(m.who, actor));
}

export interface ClaimDeleteRule {
  from: ClaimStatus;
  who: readonly ActorKind[];
}

/** The claimant may cancel a pending claim; the owner may delete a claim in any status. */
export const CLAIM_DELETES: readonly ClaimDeleteRule[] = [
  { from: 'pending', who: ['row_owner', 'owner'] },
  { from: 'approved', who: ['owner'] },
  { from: 'rejected', who: ['owner'] },
];

/**
 * - not_permitted: the actor is neither the claimant nor the owner
 * - not_permitted_decided: the actor is the claimant, but the claim is decided
 */
export type ClaimDeleteDecision = { ok: true } | { ok: false; reason: 'not_permitted' | 'not_permitted_decided' };

export function decideClaimDelete(from: ClaimStatus, actor: WorkflowActor): ClaimDeleteDecision {
  if (!CLAIM_DELETES.some((r) => actorMay(r.who, actor))) return { ok: false, reason: 'not_permitted' };
  const rule = CLAIM_DELETES.find((r) => r.from === from);
  if (!rule || !actorMay(rule.who, actor)) return { ok: false, reason: 'not_permitted_decided' };
  return { ok: true };
}
