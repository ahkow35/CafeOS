import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEAVE_STATUSES,
  decideLeaveDelete,
  decideLeaveMove,
  leaveActionsFor,
  type LeaveStatus,
} from '../src/lib/workflows/leave';
import type { WorkflowActor } from '../src/lib/workflows/actor';

const ACTORS: Record<string, WorkflowActor> = {
  'manager, other request': { role: 'manager', isRowOwner: false },
  'manager, own request': { role: 'manager', isRowOwner: true },
  'owner, other request': { role: 'owner', isRowOwner: false },
  'owner, own request': { role: 'owner', isRowOwner: true },
  'staff, own request': { role: 'staff', isRowOwner: true },
  'staff, other request': { role: 'staff', isRowOwner: false },
};

type Expected = 'ok' | 'already_decided' | 'own_request' | 'not_permitted';

// One row per (from, to, actor). The manager approves by passing the request to the
// owner (to = pending_owner); the owner approves directly (to = approved).
const MOVES: Array<[LeaveStatus, LeaveStatus, string, Expected]> = [
  ['pending_manager', 'pending_owner', 'manager, other request', 'ok'],
  ['pending_manager', 'pending_owner', 'manager, own request', 'own_request'],
  ['pending_owner', 'pending_owner', 'manager, other request', 'not_permitted'],
  ['pending_owner', 'pending_owner', 'manager, own request', 'own_request'],
  ['approved', 'pending_owner', 'manager, other request', 'already_decided'],
  ['rejected', 'pending_owner', 'manager, own request', 'already_decided'],
  ['pending_manager', 'pending_owner', 'owner, other request', 'not_permitted'],

  ['pending_manager', 'approved', 'owner, other request', 'ok'],
  ['pending_manager', 'approved', 'owner, own request', 'ok'],
  ['pending_owner', 'approved', 'owner, other request', 'ok'],
  ['pending_owner', 'approved', 'owner, own request', 'ok'],
  ['approved', 'approved', 'owner, other request', 'already_decided'],
  ['rejected', 'approved', 'owner, other request', 'already_decided'],
  ['pending_manager', 'approved', 'manager, other request', 'not_permitted'],
  ['pending_owner', 'approved', 'manager, other request', 'not_permitted'],
  ['pending_manager', 'approved', 'staff, other request', 'not_permitted'],

  ['pending_manager', 'rejected', 'manager, other request', 'ok'],
  ['pending_manager', 'rejected', 'manager, own request', 'own_request'],
  ['pending_owner', 'rejected', 'manager, other request', 'not_permitted'],
  ['pending_owner', 'rejected', 'manager, own request', 'own_request'],
  ['pending_manager', 'rejected', 'owner, other request', 'ok'],
  ['pending_manager', 'rejected', 'owner, own request', 'ok'],
  ['pending_owner', 'rejected', 'owner, other request', 'ok'],
  ['pending_owner', 'rejected', 'owner, own request', 'ok'],
  ['approved', 'rejected', 'owner, other request', 'already_decided'],
  ['rejected', 'rejected', 'manager, other request', 'already_decided'],
  ['pending_manager', 'rejected', 'staff, own request', 'not_permitted'],
];

for (const [from, to, who, expected] of MOVES) {
  test(`leave ${from} -> ${to} by ${who}: ${expected}`, () => {
    const decision = decideLeaveMove(from, to, ACTORS[who]);
    assert.deepEqual(decision, expected === 'ok' ? { ok: true } : { ok: false, reason: expected });
  });
}

test('leaveActionsFor lists the moves open to the actor', () => {
  const to = (from: LeaveStatus, who: string) => leaveActionsFor(from, ACTORS[who]).map((m) => m.to);
  assert.deepEqual(to('pending_manager', 'manager, other request'), ['pending_owner', 'rejected']);
  assert.deepEqual(to('pending_manager', 'manager, own request'), []);
  assert.deepEqual(to('pending_owner', 'manager, other request'), []);
  assert.deepEqual(to('pending_manager', 'owner, other request'), ['approved', 'rejected']);
  assert.deepEqual(to('pending_owner', 'owner, own request'), ['approved', 'rejected']);
  assert.deepEqual(to('approved', 'owner, other request'), []);
  assert.deepEqual(to('rejected', 'owner, other request'), []);
});

test('a move is allowed exactly when it is listed as open to the actor', () => {
  for (const actor of Object.values(ACTORS)) {
    for (const from of LEAVE_STATUSES) {
      const open = leaveActionsFor(from, actor).map((m) => m.to);
      for (const to of LEAVE_STATUSES) {
        assert.equal(decideLeaveMove(from, to, actor).ok, open.includes(to));
      }
    }
  }
});

type DeleteExpected = 'ok' | 'not_permitted' | 'not_permitted_decided';

const DELETES: Array<[LeaveStatus, string, DeleteExpected]> = [
  ['pending_manager', 'staff, own request', 'ok'],
  ['pending_manager', 'manager, own request', 'ok'],
  ['pending_manager', 'owner, other request', 'ok'],
  ['pending_manager', 'staff, other request', 'not_permitted'],
  ['pending_manager', 'manager, other request', 'not_permitted'],
  ['pending_owner', 'staff, own request', 'ok'],
  ['pending_owner', 'owner, other request', 'ok'],
  ['pending_owner', 'manager, other request', 'not_permitted'],
  ['approved', 'owner, other request', 'ok'],
  ['approved', 'owner, own request', 'ok'],
  ['approved', 'staff, own request', 'not_permitted_decided'],
  ['approved', 'manager, own request', 'not_permitted_decided'],
  ['rejected', 'owner, other request', 'ok'],
  ['rejected', 'staff, own request', 'not_permitted_decided'],
  ['rejected', 'manager, other request', 'not_permitted_decided'],
];

for (const [from, who, expected] of DELETES) {
  test(`leave delete ${from} by ${who}: ${expected}`, () => {
    const decision = decideLeaveDelete(from, ACTORS[who]);
    assert.deepEqual(decision, expected === 'ok' ? { ok: true } : { ok: false, reason: expected });
  });
}
