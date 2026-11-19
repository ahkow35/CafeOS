import type { TimesheetStatus } from './timesheet';
import type { LeaveStatus } from './leave';
import type { ClaimStatus } from './claim';
import type { CafeStatus } from './cafe';

/** How a status looks: one tone per kind of state, shared by every screen. */
export type StatusTone = 'draft' | 'manager' | 'owner' | 'approved' | 'declined';

export interface StatusLabel {
  label: string;
  tone: StatusTone;
}

/** The text and tone of every status, so each screen draws a status the same way. A missing status is a compile error. */
export const TIMESHEET_LABELS: Record<TimesheetStatus, StatusLabel> = {
  draft: { label: 'Draft', tone: 'draft' },
  submitted: { label: 'Awaiting manager', tone: 'manager' },
  pending_owner: { label: 'Awaiting owner', tone: 'owner' },
  approved: { label: 'Approved', tone: 'approved' },
  rejected: { label: 'Declined', tone: 'declined' },
};

export const LEAVE_LABELS: Record<LeaveStatus, StatusLabel> = {
  pending_manager: { label: 'Awaiting manager', tone: 'manager' },
  pending_owner: { label: 'Awaiting owner', tone: 'owner' },
  approved: { label: 'Approved', tone: 'approved' },
  rejected: { label: 'Declined', tone: 'declined' },
};

export const CLAIM_LABELS: Record<ClaimStatus, StatusLabel> = {
  pending: { label: 'Awaiting owner', tone: 'owner' },
  approved: { label: 'Approved', tone: 'approved' },
  rejected: { label: 'Declined', tone: 'declined' },
};

export const CAFE_LABELS: Record<CafeStatus, StatusLabel> = {
  pending: { label: 'Awaiting approval', tone: 'manager' },
  active: { label: 'Active', tone: 'approved' },
  suspended: { label: 'Suspended', tone: 'declined' },
};

/** The badge class for each tone. */
export const TONE_CLASS: Record<StatusTone, string> = {
  draft: 'badge-info',
  manager: 'badge-warning',
  owner: 'badge-owner',
  approved: 'badge-success',
  declined: 'badge-danger',
};

export type StatusWorkflow = 'timesheet' | 'leave' | 'claim' | 'cafe';

const LABELS: Record<StatusWorkflow, Record<string, StatusLabel>> = {
  timesheet: TIMESHEET_LABELS,
  leave: LEAVE_LABELS,
  claim: CLAIM_LABELS,
  cafe: CAFE_LABELS,
};

/** The label and tone for a status, or undefined when the workflow has no such status. */
export function statusLabel(workflow: StatusWorkflow, status: string): StatusLabel | undefined {
  const table = LABELS[workflow];
  return Object.prototype.hasOwnProperty.call(table, status) ? table[status] : undefined;
}
