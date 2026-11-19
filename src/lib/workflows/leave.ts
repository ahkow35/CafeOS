import { actorMay, type ActorKind, type WorkflowActor } from './actor';

export const LEAVE_STATUSES = ['pending_manager', 'pending_owner', 'approved', 'rejected'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export interface LeaveMove {
  from: LeaveStatus;
  to: LeaveStatus;
  /** Any one of these kinds of actor may make the move. */
  who: readonly ActorKind[];
}

/**
 * The decisions on a leave request. A manager passes a request on to the owner or
 * rejects it, only at the manager stage and not on their own request; the owner
 * approves or rejects at either stage. An approved or rejected request is final.
 */
export const LEAVE_MOVES: readonly LeaveMove[] = [
  { from: 'pending_manager', to: 'pending_owner', who: ['manager_not_row_owner'] },
  { from: 'pending_manager', to: 'approved', who: ['owner'] },
  { from: 'pending_owner', to: 'approved', who: ['owner'] },
  { from: 'pending_manager', to: 'rejected', who: ['manager_not_row_owner', 'owner'] },
  { from: 'pending_owner', to: 'rejected', who: ['owner'] },
];

/**
 * - already_decided: the request is approved or rejected, so no move leaves it
 * - own_request: the actor is a manager and the request is their own
 * - not_permitted: the actor may not make this move from the request's status
 */
export type LeaveMoveDecision =
  | { ok: true }
  | { ok: false; reason: 'already_decided' | 'own_request' | 'not_permitted' };

/** The status check on a decided request comes first, then the actor checks, as the route has always answered. */
export function decideLeaveMove(from: LeaveStatus, to: LeaveStatus, actor: WorkflowActor): LeaveMoveDecision {
  if (!LEAVE_MOVES.some((m) => m.from === from)) return { ok: false, reason: 'already_decided' };
  // A manager never acts on their own request, whatever its stage.
  if (actor.isRowOwner && actor.role === 'manager') return { ok: false, reason: 'own_request' };
  const move = LEAVE_MOVES.find((m) => m.from === from && m.to === to);
  if (move && actorMay(move.who, actor)) return { ok: true };
  return { ok: false, reason: 'not_permitted' };
}

/** The moves from `from` that are open to this actor. */
export function leaveActionsFor(from: LeaveStatus, actor: WorkflowActor): LeaveMove[] {
  return LEAVE_MOVES.filter((m) => m.from === from && actorMay(m.who, actor));
}

export interface LeaveDeleteRule {
  from: LeaveStatus;
  who: readonly ActorKind[];
}

/** Who may delete a request in each status: its requester or the owner while it is open, only the owner once it is decided. */
export const LEAVE_DELETES: readonly LeaveDeleteRule[] = [
  { from: 'pending_manager', who: ['row_owner', 'owner'] },
  { from: 'pending_owner', who: ['row_owner', 'owner'] },
  { from: 'approved', who: ['owner'] },
  { from: 'rejected', who: ['owner'] },
];

/** not_permitted_decided: the request is decided and the actor is not the owner; not_permitted: the request is open and the actor is neither its requester nor the owner. */
export type LeaveDeleteDecision =
  | { ok: true }
  | { ok: false; reason: 'not_permitted_decided' | 'not_permitted' };

export function decideLeaveDelete(from: LeaveStatus, actor: WorkflowActor): LeaveDeleteDecision {
  const rule = LEAVE_DELETES.find((r) => r.from === from);
  if (rule && actorMay(rule.who, actor)) return { ok: true };
  return { ok: false, reason: from === 'approved' || from === 'rejected' ? 'not_permitted_decided' : 'not_permitted' };
}
