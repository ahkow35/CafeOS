import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIMESHEET_STATUSES,
  decideTimesheetDelete,
  decideTimesheetMove,
  isTimesheetStatus,
  timesheetActionsFor,
  type TimesheetStatus,
} from '../src/lib/workflows/timesheet';
import type { WorkflowActor } from '../src/lib/workflows/actor';

const ACTORS: Record<string, WorkflowActor> = {
  'part-timer, own sheet': { role: 'part_timer', isRowOwner: true },
  'part-timer, other sheet': { role: 'part_timer', isRowOwner: false },
  'staff, own sheet': { role: 'staff', isRowOwner: true },
  'manager, own sheet': { role: 'manager', isRowOwner: true },
  'manager, other sheet': { role: 'manager', isRowOwner: false },
  'owner, own sheet': { role: 'owner', isRowOwner: true },
  'owner, other sheet': { role: 'owner', isRowOwner: false },
};

type Reason = 'not_permitted' | 'not_permitted_at_status' | 'wrong_status';
type Expected = 'ok' | Reason;

// One row per (from, to, actor): the expected decision.
const ROWS: Array<[TimesheetStatus, TimesheetStatus, string, Expected]> = [
  ['draft', 'submitted', 'part-timer, own sheet', 'ok'],
  ['draft', 'submitted', 'staff, own sheet', 'ok'],
  ['draft', 'submitted', 'manager, own sheet', 'ok'],
  ['draft', 'submitted', 'owner, own sheet', 'ok'],
  ['draft', 'submitted', 'part-timer, other sheet', 'not_permitted'],
  ['draft', 'submitted', 'manager, other sheet', 'not_permitted'],
  ['draft', 'submitted', 'owner, other sheet', 'not_permitted'],
  ['submitted', 'submitted', 'part-timer, own sheet', 'wrong_status'],
  ['approved', 'submitted', 'owner, own sheet', 'wrong_status'],
  ['rejected', 'submitted', 'part-timer, own sheet', 'wrong_status'],
  ['pending_owner', 'submitted', 'staff, own sheet', 'wrong_status'],

  ['submitted', 'pending_owner', 'manager, other sheet', 'ok'],
  ['submitted', 'pending_owner', 'manager, own sheet', 'ok'],
  ['submitted', 'pending_owner', 'owner, other sheet', 'ok'],
  ['submitted', 'pending_owner', 'part-timer, own sheet', 'not_permitted'],
  ['submitted', 'pending_owner', 'staff, own sheet', 'not_permitted'],
  ['draft', 'pending_owner', 'manager, other sheet', 'wrong_status'],
  ['pending_owner', 'pending_owner', 'owner, other sheet', 'wrong_status'],
  ['approved', 'pending_owner', 'manager, other sheet', 'wrong_status'],
  ['rejected', 'pending_owner', 'manager, other sheet', 'wrong_status'],
  ['draft', 'pending_owner', 'part-timer, own sheet', 'not_permitted'],

  ['submitted', 'approved', 'owner, other sheet', 'ok'],
  ['pending_owner', 'approved', 'owner, other sheet', 'ok'],
  ['submitted', 'approved', 'owner, own sheet', 'ok'],
  ['submitted', 'approved', 'manager, other sheet', 'not_permitted'],
  ['pending_owner', 'approved', 'manager, other sheet', 'not_permitted'],
  ['submitted', 'approved', 'part-timer, own sheet', 'not_permitted'],
  ['draft', 'approved', 'owner, other sheet', 'wrong_status'],
  ['approved', 'approved', 'owner, other sheet', 'wrong_status'],
  ['rejected', 'approved', 'owner, other sheet', 'wrong_status'],

  ['submitted', 'rejected', 'manager, other sheet', 'ok'],
  ['submitted', 'rejected', 'owner, other sheet', 'ok'],
  ['pending_owner', 'rejected', 'owner, other sheet', 'ok'],
  ['pending_owner', 'rejected', 'manager, other sheet', 'not_permitted_at_status'],
  ['pending_owner', 'rejected', 'manager, own sheet', 'not_permitted_at_status'],
  ['submitted', 'rejected', 'part-timer, own sheet', 'not_permitted'],
  ['pending_owner', 'rejected', 'staff, own sheet', 'not_permitted'],
  ['draft', 'rejected', 'manager, other sheet', 'wrong_status'],
  ['approved', 'rejected', 'manager, other sheet', 'wrong_status'],
  ['rejected', 'rejected', 'owner, other sheet', 'wrong_status'],

  ['rejected', 'draft', 'part-timer, own sheet', 'ok'],
  ['rejected', 'draft', 'manager, own sheet', 'ok'],
  ['rejected', 'draft', 'owner, own sheet', 'ok'],
  ['rejected', 'draft', 'owner, other sheet', 'not_permitted'],
  ['rejected', 'draft', 'manager, other sheet', 'not_permitted'],
  ['rejected', 'draft', 'part-timer, other sheet', 'not_permitted'],
  ['draft', 'draft', 'part-timer, own sheet', 'wrong_status'],
  ['submitted', 'draft', 'part-timer, own sheet', 'wrong_status'],
  ['approved', 'draft', 'owner, own sheet', 'wrong_status'],
];

for (const [from, to, who, expected] of ROWS) {
  test(`timesheet ${from} -> ${to} by ${who}: ${expected}`, () => {
    const decision = decideTimesheetMove(from, to, ACTORS[who]);
    assert.deepEqual(decision, expected === 'ok' ? { ok: true } : { ok: false, reason: expected });
  });
}

test('every status has a row in the status list and is recognised', () => {
  for (const s of TIMESHEET_STATUSES) assert.equal(isTimesheetStatus(s), true);
  assert.equal(isTimesheetStatus('done'), false);
  assert.equal(isTimesheetStatus(undefined), false);
});

test('timesheetActionsFor lists the moves open to the actor', () => {
  const to = (from: TimesheetStatus, who: string) => timesheetActionsFor(from, ACTORS[who]).map((m) => m.to);
  assert.deepEqual(to('draft', 'part-timer, own sheet'), ['submitted']);
  assert.deepEqual(to('draft', 'owner, other sheet'), []);
  assert.deepEqual(to('submitted', 'manager, other sheet'), ['pending_owner', 'rejected']);
  assert.deepEqual(to('submitted', 'owner, other sheet'), ['pending_owner', 'approved', 'rejected']);
  assert.deepEqual(to('pending_owner', 'manager, other sheet'), []);
  assert.deepEqual(to('pending_owner', 'owner, other sheet'), ['approved', 'rejected']);
  assert.deepEqual(to('approved', 'owner, own sheet'), []);
  assert.deepEqual(to('rejected', 'part-timer, own sheet'), ['draft']);
  assert.deepEqual(to('rejected', 'owner, other sheet'), []);
});

// The delete answer for every status and every kind of person, written out as plain conditions.
function expectedDelete(status: TimesheetStatus, a: WorkflowActor): 'ok' | 'not_permitted' | 'drafts_only' | 'approved' {
  const admin = a.role === 'manager' || a.role === 'owner';
  if (!a.isRowOwner && !admin) return 'not_permitted';
  if (!admin && status !== 'draft') return 'drafts_only';
  if (status === 'approved') return 'approved';
  return 'ok';
}

for (const status of TIMESHEET_STATUSES) {
  for (const [who, actor] of Object.entries(ACTORS)) {
    test(`timesheet delete at ${status} by ${who}`, () => {
      const expected = expectedDelete(status, actor);
      assert.deepEqual(decideTimesheetDelete(status, actor), expected === 'ok' ? { ok: true } : { ok: false, reason: expected });
    });
  }
}
