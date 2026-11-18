import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TASK_STATUSES, decideTaskMove, isTaskStatus, taskActionsFor, type TaskStatus } from '../src/lib/workflows/task';
import type { WorkflowActor } from '../src/lib/workflows/actor';

// For a task the row owner is its assignee.
const ACTORS: Record<string, WorkflowActor> = {
  'staff, assignee': { role: 'staff', isRowOwner: true },
  'staff, not assignee': { role: 'staff', isRowOwner: false },
  'part-timer, assignee': { role: 'part_timer', isRowOwner: true },
  'part-timer, not assignee': { role: 'part_timer', isRowOwner: false },
  'manager, not assignee': { role: 'manager', isRowOwner: false },
  'manager, assignee': { role: 'manager', isRowOwner: true },
  'owner, not assignee': { role: 'owner', isRowOwner: false },
  'owner, assignee': { role: 'owner', isRowOwner: true },
};

const ALLOWED = ['staff, assignee', 'part-timer, assignee', 'manager, not assignee', 'manager, assignee', 'owner, not assignee', 'owner, assignee'];
const REFUSED = ['staff, not assignee', 'part-timer, not assignee'];

for (const from of TASK_STATUSES) {
  for (const to of TASK_STATUSES) {
    for (const who of ALLOWED) {
      test(`task ${from} -> ${to} by ${who}: ok`, () => {
        assert.deepEqual(decideTaskMove(from, to, ACTORS[who]), { ok: true });
      });
    }
    for (const who of REFUSED) {
      test(`task ${from} -> ${to} by ${who}: not_permitted`, () => {
        assert.deepEqual(decideTaskMove(from, to, ACTORS[who]), { ok: false, reason: 'not_permitted' });
      });
    }
  }
}

test('taskActionsFor lists both statuses to an assignee or admin and none to anyone else', () => {
  const to = (from: TaskStatus, who: string) => taskActionsFor(from, ACTORS[who]).map((m) => m.to);
  assert.deepEqual(to('pending', 'staff, assignee'), ['pending', 'done']);
  assert.deepEqual(to('done', 'owner, not assignee'), ['pending', 'done']);
  assert.deepEqual(to('pending', 'staff, not assignee'), []);
});

test('only the listed statuses are recognised', () => {
  for (const s of TASK_STATUSES) assert.equal(isTaskStatus(s), true);
  assert.equal(isTaskStatus('approved'), false);
  assert.equal(isTaskStatus(null), false);
});
