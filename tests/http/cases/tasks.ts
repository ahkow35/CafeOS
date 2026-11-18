/** Tasks: tick and untick for a task assigned to one person and for a task assigned to everyone. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { api, env, newMember, row, rows, type Json, type Person } from '../harness';
import { byId, expectStatus, refuse, stampIs } from './util';

const DEADLINE = '3030-01-01T00:00:00.000Z';

async function seedTask(assignedTo: string): Promise<string> {
  const r = await row<{ id: string }>(
    `INSERT INTO tasks (cafe_id, title, deadline, assigned_to, created_by) VALUES ($1, 'Wipe the machine', $2, $3, $4) RETURNING id`,
    [env.cafe1, DEADLINE, assignedTo, env.people.manager.id],
  );
  return r!.id;
}

/** The status this person sees for one task in their own list. */
async function seenBy(who: Person, taskId: string): Promise<Json | undefined> {
  const r = await api('GET', '/api/tasks?scope=mine', { as: who });
  return r.json.tasks.find((t: { id: string }) => t.id === taskId);
}

const tick = (id: string, as: Person, status: 'done' | 'pending') => api('PATCH', `/api/tasks/${id}`, { as, body: { status } });

export function taskCases(): void {
  describe('tasks: assigned to one person', () => {
    test('assignee ticks and unticks; the task row carries the stamps', async () => {
      const a = await newMember('staff');
      const id = await seedTask(a.id);
      expectStatus(await tick(id, a, 'done'), 200);
      let t = await byId('tasks', id);
      assert.equal(t?.status, 'done');
      stampIs(t, 'completed_by', a.id);
      assert.ok(t?.completed_at);
      assert.equal((await seenBy(a, id))?.status, 'done');
      expectStatus(await tick(id, a, 'pending'), 200);
      t = await byId('tasks', id);
      assert.deepEqual([t?.status, t?.completed_by, t?.completed_at], ['pending', null, null]);
      assert.equal((await seenBy(a, id))?.status, 'pending');
    });

    test('someone else on the team cannot tick it; a manager can, and is recorded as the completer', async () => {
      const a = await newMember('staff');
      const id = await seedTask(a.id);
      refuse('task PATCH tick | assigned to one person | by other staff', await tick(id, env.people.staff, 'done'), 403);
      assert.equal((await byId('tasks', id))?.status, 'pending');
      expectStatus(await tick(id, env.people.manager, 'done'), 200);
      stampIs(await byId('tasks', id), 'completed_by', env.people.manager.id);
      assert.equal((await seenBy(a, id))?.status, 'done'); // the assignee sees it done
      assert.equal(await seenBy(env.people.staff, id), undefined); // and nobody else lists it
    });

    test('only managers change the title or assignee; a missing status field is a 400', async () => {
      const a = await newMember('staff');
      const id = await seedTask(a.id);
      refuse('task PATCH title | by assignee', await api('PATCH', `/api/tasks/${id}`, { as: a, body: { title: 'mine' } }), 403);
      refuse('task PATCH | no status field | by assignee', await api('PATCH', `/api/tasks/${id}`, { as: a, body: {} }), 400);
      refuse('task PATCH | unknown status value | by assignee', await api('PATCH', `/api/tasks/${id}`, { as: a, body: { status: 'half' } }), 400);
      expectStatus(await api('PATCH', `/api/tasks/${id}`, { as: env.people.manager, body: { title: 'Renamed' } }), 200);
      assert.equal((await byId('tasks', id))?.title, 'Renamed');
    });

    test('other cafe cannot see or tick it', async () => {
      const a = await newMember('staff');
      const id = await seedTask(a.id);
      refuse('task PATCH tick | other cafe | by owner2', await tick(id, env.people.owner2, 'done'), 404);
    });
  });

  describe('tasks: assigned to everyone', () => {
    test('each person ticks their own copy; the task row stays pending', async () => {
      const a = await newMember('staff');
      const b = await newMember('part_timer');
      const id = await seedTask('all');
      expectStatus(await tick(id, a, 'done'), 200);
      assert.equal((await tick(id, a, 'done')).json.task.status, 'done'); // ticking twice is harmless
      assert.deepEqual([(await seenBy(a, id))?.status, (await seenBy(b, id))?.status], ['done', 'pending']);
      const t = await byId('tasks', id);
      assert.deepEqual([t?.status, t?.completed_by], ['pending', null]);
      const done = await rows(`SELECT user_id FROM task_completions WHERE task_id = $1`, [id]);
      assert.deepEqual(done.map((d) => d.user_id), [a.id]);
    });

    test('unticking removes only that person completion', async () => {
      const a = await newMember('staff');
      const b = await newMember('staff');
      const id = await seedTask('all');
      await tick(id, a, 'done');
      await tick(id, b, 'done');
      const r = await tick(id, a, 'pending');
      expectStatus(r, 200);
      assert.deepEqual([r.json.task.status, r.json.task.completed_by], ['pending', null]);
      assert.deepEqual([(await seenBy(a, id))?.status, (await seenBy(b, id))?.status], ['pending', 'done']);
    });

    test('a manager ticking records only their own completion', async () => {
      const a = await newMember('staff');
      const id = await seedTask('all');
      expectStatus(await tick(id, env.people.manager, 'done'), 200);
      assert.equal((await seenBy(env.people.manager, id))?.status, 'done');
      assert.equal((await seenBy(a, id))?.status, 'pending');
    });

    test('creating and deleting: managers only', async () => {
      const a = await newMember('staff');
      const body = { title: 'Close up', deadline: DEADLINE, assigned_to: 'all' };
      refuse('task POST | by staff', await api('POST', '/api/tasks', { as: a, body }), 403);
      const r = await api('POST', '/api/tasks', { as: env.people.manager, body });
      expectStatus(r, 201);
      assert.deepEqual([r.json.task.status, r.json.task.assigned_to], ['pending', 'all']);
      refuse('task DELETE | by staff', await api('DELETE', `/api/tasks/${r.json.task.id}`, { as: a }), 403);
      expectStatus(await api('DELETE', `/api/tasks/${r.json.task.id}`, { as: env.people.manager }), 200);
      assert.equal(await byId('tasks', r.json.task.id), undefined);
    });
  });
}
