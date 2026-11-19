import { actorMay, type ActorKind, type WorkflowActor } from './actor';

export const TIMESHEET_STATUSES = ['draft', 'submitted', 'pending_owner', 'approved', 'rejected'] as const;
export type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number];

export function isTimesheetStatus(value: unknown): value is TimesheetStatus {
  return TIMESHEET_STATUSES.some((s) => s === value);
}

export interface TimesheetMove {
  from: TimesheetStatus;
  to: TimesheetStatus;
  /** Any one of these kinds of actor may make the move. */
  who: readonly ActorKind[];
}

/**
 * The moves a timesheet can make (part-timer, then manager, then owner):
 * - a part-timer submits a draft and reopens a rejected sheet;
 * - a manager forwards a submitted sheet to the owner;
 * - the owner approves a submitted or forwarded sheet;
 * - a manager or the owner rejects a submitted sheet, only the owner a forwarded one.
 */
export const TIMESHEET_MOVES: readonly TimesheetMove[] = [
  { from: 'draft', to: 'submitted', who: ['row_owner'] },
  { from: 'submitted', to: 'pending_owner', who: ['manager', 'owner'] },
  { from: 'submitted', to: 'approved', who: ['owner'] },
  { from: 'pending_owner', to: 'approved', who: ['owner'] },
  { from: 'submitted', to: 'rejected', who: ['manager', 'owner'] },
  { from: 'pending_owner', to: 'rejected', who: ['owner'] },
  { from: 'rejected', to: 'draft', who: ['row_owner'] },
];

/**
 * - not_permitted: the actor may not move a timesheet to that status from any status
 * - not_permitted_at_status: the actor may move to it, but not from the sheet's current status
 * - wrong_status: no move leads to that status from the current one
 */
export type TimesheetMoveDecision =
  | { ok: true }
  | { ok: false; reason: 'not_permitted' | 'not_permitted_at_status' | 'wrong_status' };

/** The actor check comes before the status check, as the route has always answered. */
export function decideTimesheetMove(from: TimesheetStatus, to: TimesheetStatus, actor: WorkflowActor): TimesheetMoveDecision {
  const towards = TIMESHEET_MOVES.filter((m) => m.to === to);
  if (!towards.some((m) => actorMay(m.who, actor))) return { ok: false, reason: 'not_permitted' };
  const move = towards.find((m) => m.from === from);
  if (!move) return { ok: false, reason: 'wrong_status' };
  if (!actorMay(move.who, actor)) return { ok: false, reason: 'not_permitted_at_status' };
  return { ok: true };
}

/** The moves from `from` that are open to this actor. */
export function timesheetActionsFor(from: TimesheetStatus, actor: WorkflowActor): TimesheetMove[] {
  return TIMESHEET_MOVES.filter((m) => m.from === from && actorMay(m.who, actor));
}

export interface TimesheetDeleteRule {
  from: TimesheetStatus;
  who: readonly ActorKind[];
}

/**
 * Who may delete a timesheet in each status: its owner while it is a draft, a manager or the
 * owner while it is not approved. An approved timesheet is the pay record and nobody deletes it.
 */
export const TIMESHEET_DELETES: readonly TimesheetDeleteRule[] = [
  { from: 'draft', who: ['row_owner', 'manager', 'owner'] },
  { from: 'submitted', who: ['manager', 'owner'] },
  { from: 'pending_owner', who: ['manager', 'owner'] },
  { from: 'approved', who: [] },
  { from: 'rejected', who: ['manager', 'owner'] },
];

/**
 * - not_permitted: the actor is neither a manager, the owner nor the sheet's own person
 * - drafts_only: the actor is the sheet's own person and the sheet is no longer a draft
 * - approved: a manager or the owner asks to delete an approved sheet
 */
export type TimesheetDeleteDecision =
  | { ok: true }
  | { ok: false; reason: 'not_permitted' | 'drafts_only' | 'approved' };

/** The checks run in this order, as the route has always answered. */
export function decideTimesheetDelete(from: TimesheetStatus, actor: WorkflowActor): TimesheetDeleteDecision {
  const rule = TIMESHEET_DELETES.find((r) => r.from === from);
  if (rule && actorMay(rule.who, actor)) return { ok: true };
  const isAdmin = actor.role === 'manager' || actor.role === 'owner';
  if (!actor.isRowOwner && !isAdmin) return { ok: false, reason: 'not_permitted' };
  if (!isAdmin) return { ok: false, reason: 'drafts_only' };
  return { ok: false, reason: 'approved' };
}
