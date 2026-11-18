import type { MembershipRole } from '@/lib/validators';

/**
 * Who is asking to move a row to a new status. Shared by the workflow tables in
 * this folder, which are pure: they import nothing that touches the database,
 * the session or the network, so screens and tests can load them too.
 */
export type ActorKind = 'row_owner' | 'manager' | 'owner';

export interface WorkflowActor {
  /** The person's role in the cafe. */
  role: MembershipRole;
  /** True when the row belongs to this person (their own timesheet, leave request, ...). */
  isRowOwner: boolean;
}

/** Whether the actor is any of the allowed kinds. 'manager' and 'owner' mean that exact role. */
export function actorMay(allowed: readonly ActorKind[], actor: WorkflowActor): boolean {
  return allowed.some((kind) => (kind === 'row_owner' ? actor.isRowOwner : actor.role === kind));
}
