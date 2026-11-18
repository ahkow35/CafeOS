import { actorMay, type ActorKind, type WorkflowActor } from './actor';

export const TASK_STATUSES = ['pending', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export function isTaskStatus(value: unknown): value is TaskStatus {
  return TASK_STATUSES.some((s) => s === value);
}

export interface TaskMove {
  from: TaskStatus;
  to: TaskStatus;
  /** Any one of these kinds of actor may make the move; for a task the row owner is the assignee. */
  who: readonly ActorKind[];
}

const ASSIGNEE_OR_ADMIN: readonly ActorKind[] = ['row_owner', 'manager', 'owner'];

/** The assignee, a manager or the owner may mark a task done or pending again, from either status. */
export const TASK_MOVES: readonly TaskMove[] = [
  { from: 'pending', to: 'pending', who: ASSIGNEE_OR_ADMIN },
  { from: 'pending', to: 'done', who: ASSIGNEE_OR_ADMIN },
  { from: 'done', to: 'pending', who: ASSIGNEE_OR_ADMIN },
  { from: 'done', to: 'done', who: ASSIGNEE_OR_ADMIN },
];

export type TaskMoveDecision = { ok: true } | { ok: false; reason: 'not_permitted' };

export function decideTaskMove(from: TaskStatus, to: TaskStatus, actor: WorkflowActor): TaskMoveDecision {
  const move = TASK_MOVES.find((m) => m.from === from && m.to === to);
  return move && actorMay(move.who, actor) ? { ok: true } : { ok: false, reason: 'not_permitted' };
}

/** The moves from `from` that are open to this actor. */
export function taskActionsFor(from: TaskStatus, actor: WorkflowActor): TaskMove[] {
  return TASK_MOVES.filter((m) => m.from === from && actorMay(m.who, actor));
}
