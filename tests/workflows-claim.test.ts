import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLAIM_STATUSES,
  claimActionsFor,
  decideClaimDelete,
  decideClaimMove,
  type ClaimStatus,
} from '../src/lib/workflows/claim';
import type { WorkflowActor } from '../src/lib/workflows/actor';

const ACTORS: Record<string, WorkflowActor> = {
  'owner, other claim': { role: 'owner', isRowOwner: false },
  'owner, own claim': { role: 'owner', isRowOwner: true },
  'manager, own claim': { role: 'manager', isRowOwner: true },
  'manager, other claim': { role: 'manager', isRowOwner: false },
  'staff, own claim': { role: 'staff', isRowOwner: true },
  'staff, other claim': { role: 'staff', isRowOwner: false },
};

type Expected = 'ok' | 'not_permitted' | 'already_decided';

const MOVES: Array<[ClaimStatus, ClaimStatus, string, Expected]> = [
  ['pending', 'approved', 'owner, other claim', 'ok'],
  ['pending', 'approved', 'owner, own claim', 'ok'],
  ['pending', 'rejected', 'owner, other claim', 'ok'],
  ['pending', 'approved', 'manager, other claim', 'not_permitted'],
  ['pending', 'rejected', 'manager, own claim', 'not_permitted'],
  ['pending', 'approved', 'staff, own claim', 'not_permitted'],
  ['pending', 'rejected', 'staff, other claim', 'not_permitted'],
  ['approved', 'approved', 'owner, other claim', 'already_decided'],
  ['approved', 'rejected', 'owner, other claim', 'already_decided'],
  ['rejected', 'approved', 'owner, other claim', 'already_decided'],
  ['rejected', 'rejected', 'owner, other claim', 'already_decided'],
  ['approved', 'approved', 'manager, other claim', 'not_permitted'],
  ['rejected', 'rejected', 'staff, own claim', 'not_permitted'],
];

for (const [from, to, who, expected] of MOVES) {
  test(`claim ${from} -> ${to} by ${who}: ${expected}`, () => {
    const decision = decideClaimMove(from, to, ACTORS[who]);
    assert.deepEqual(decision, expected === 'ok' ? { ok: true } : { ok: false, reason: expected });
  });
}

test('claimActionsFor lists the moves open to the actor', () => {
  const to = (from: ClaimStatus, who: string) => claimActionsFor(from, ACTORS[who]).map((m) => m.to);
  assert.deepEqual(to('pending', 'owner, other claim'), ['approved', 'rejected']);
  assert.deepEqual(to('pending', 'manager, other claim'), []);
  assert.deepEqual(to('pending', 'staff, own claim'), []);
  assert.deepEqual(to('approved', 'owner, other claim'), []);
  assert.deepEqual(to('rejected', 'owner, own claim'), []);
});

test('a move is allowed exactly when it is listed as open to the actor', () => {
  for (const actor of Object.values(ACTORS)) {
    for (const from of CLAIM_STATUSES) {
      const open = claimActionsFor(from, actor).map((m) => m.to);
      for (const to of CLAIM_STATUSES) {
        assert.equal(decideClaimMove(from, to, actor).ok, open.includes(to));
      }
    }
  }
});

type DeleteExpected = 'ok' | 'not_permitted' | 'not_permitted_decided';

const DELETES: Array<[ClaimStatus, string, DeleteExpected]> = [
  ['pending', 'staff, own claim', 'ok'],
  ['pending', 'manager, own claim', 'ok'],
  ['pending', 'owner, other claim', 'ok'],
  ['pending', 'owner, own claim', 'ok'],
  ['pending', 'staff, other claim', 'not_permitted'],
  ['pending', 'manager, other claim', 'not_permitted'],
  ['approved', 'owner, other claim', 'ok'],
  ['rejected', 'owner, other claim', 'ok'],
  ['approved', 'staff, own claim', 'not_permitted_decided'],
  ['rejected', 'manager, own claim', 'not_permitted_decided'],
  ['approved', 'staff, other claim', 'not_permitted'],
  ['rejected', 'manager, other claim', 'not_permitted'],
];

for (const [from, who, expected] of DELETES) {
  test(`claim delete ${from} by ${who}: ${expected}`, () => {
    const decision = decideClaimDelete(from, ACTORS[who]);
    assert.deepEqual(decision, expected === 'ok' ? { ok: true } : { ok: false, reason: expected });
  });
}
