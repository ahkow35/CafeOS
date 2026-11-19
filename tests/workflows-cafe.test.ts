import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAFE_STATUSES, cafeActionsFor, decideCafeMove, type CafeAction, type CafeStatus } from '../src/lib/workflows/cafe';

// One row per (from, action): is the move open to a super admin?
const ROWS: Array<[CafeStatus, CafeAction, boolean]> = [
  ['pending', 'approve', true],
  ['active', 'approve', false],
  ['suspended', 'approve', false],
  ['pending', 'reject', true],
  ['active', 'reject', false],
  ['suspended', 'reject', false],
  ['pending', 'suspend', true],
  ['active', 'suspend', true],
  ['suspended', 'suspend', true],
];

for (const [from, action, open] of ROWS) {
  test(`cafe ${from} ${action}: ${open ? 'ok' : 'wrong_status'}`, () => {
    assert.deepEqual(decideCafeMove(from, action), open ? { ok: true } : { ok: false, reason: 'wrong_status' });
  });
}

test('cafeActionsFor lists the moves open from each status', () => {
  const names = (from: CafeStatus) => cafeActionsFor(from).map((m) => m.action);
  assert.deepEqual(names('pending'), ['approve', 'reject', 'suspend']);
  assert.deepEqual(names('active'), ['suspend']);
  assert.deepEqual(names('suspended'), ['suspend']);
});

test('every listed status is covered by the rows above', () => {
  for (const s of CAFE_STATUSES) assert.ok(ROWS.some(([from]) => from === s));
});
