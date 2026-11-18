/**
 * Requests that meet a status change: the parent row is changed by this test's own connection and
 * left uncommitted, the request is sent, and the change is committed once the request has either
 * answered or shows as waiting on a lock. A move that checks the status again inside its write is
 * made to wait and then answers what its own checks answer for the new status; the rows are read
 * back afterwards.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, env, newCafeWithOwner, row, type Reply } from '../harness';
import { byId, refuse } from './util';
import { annual, seedLeave } from './leave';
import { seedSheet } from './timesheets';
import { seedEntry } from './timesheet-entries';

/**
 * Run `change` on its own connection (uncommitted), send the request, wait until the request has
 * answered or is waiting on a lock whose statement matches `waitingStatement`, then commit.
 * `waited` says whether the request was seen waiting, so a case can show the two really met.
 */
async function meetsStatusChange(
  change: { text: string; params: unknown[] },
  waitingStatement: string,
  send: () => Promise<Reply>,
): Promise<{ reply: Reply; waited: boolean }> {
  const holder = await env.pool.connect();
  let reply: Promise<Reply> | undefined;
  let waited = false;
  try {
    await holder.query('BEGIN');
    await holder.query(change.text, change.params);
    let answered = false;
    reply = send();
    reply.then(() => { answered = true; }, () => { answered = true; });
    const deadline = Date.now() + 20_000;
    while (!answered) {
      const waiting = await row<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE $1`, [waitingStatement]);
      if (waiting && waiting.n > 0) { waited = true; break; }
      assert.ok(Date.now() < deadline, 'the request should answer or wait on a lock');
      await new Promise((r) => setTimeout(r, 50));
    }
    await holder.query('COMMIT');
  } catch (e) {
    await holder.query('ROLLBACK').catch(() => {});
    reply?.catch(() => {});
    throw e;
  } finally {
    holder.release();
  }
  return { reply: await reply, waited };
}

const SUBMIT = { text: `UPDATE timesheets SET status = 'submitted' WHERE id = $1`, params: [] as unknown[] };
const count = async (table: string, col: string, id: string): Promise<number> =>
  (await row(`SELECT count(*)::int AS n FROM ${table} WHERE ${col} = $1`, [id]))!.n;

export function statusInsideWriteCases(): void {
  describe('a request that meets a status change: timesheet entries', () => {
    test('edit entry while the sheet is submitted meanwhile -> 400, entry unchanged', async () => {
      const { id, pt } = await seedSheet('draft');
      const entry = await seedEntry(id);
      const { reply, waited } = await meetsStatusChange({ ...SUBMIT, params: [id] }, '%timesheets%FOR UPDATE%',
        () => api('PATCH', `/api/timesheet-entries/${entry}`, { as: pt, body: { remarks: 'edited' } }));
      refuse('timesheet entry PATCH | sheet submitted meanwhile | by pt', reply, 400);
      const after = await byId('timesheet_entries', entry);
      assert.deepEqual([after?.remarks, Number(after?.total_hours)], [null, 8]);
      assert.ok(waited, 'the request should have been waiting on the timesheet row');
    });

    test('delete entry while the sheet is submitted meanwhile -> 400, entry kept', async () => {
      const { id, pt } = await seedSheet('draft');
      const entry = await seedEntry(id);
      const { reply, waited } = await meetsStatusChange({ ...SUBMIT, params: [id] }, '%timesheets%FOR UPDATE%',
        () => api('DELETE', `/api/timesheet-entries/${entry}`, { as: pt }));
      refuse('timesheet entry DELETE | sheet submitted meanwhile | by pt', reply, 400);
      assert.equal(await count('timesheet_entries', 'id', entry), 1);
      assert.ok(waited, 'the request should have been waiting on the timesheet row');
    });
  });

  describe('a request that meets a status change: leave and timesheet delete', () => {
    test('delete leave while the request is approved meanwhile -> 403, request and balance kept', async () => {
      const { id, who } = await seedLeave('pending_manager');
      const before = await annual(who.id);
      const approve = { text: `UPDATE leave_requests SET status = 'approved', owner_action_by = $2, owner_action_at = NOW(), updated_at = NOW() WHERE id = $1`, params: [id, env.people.owner.id] };
      const { reply, waited } = await meetsStatusChange(approve, '%leave_requests%FOR UPDATE%',
        () => api('DELETE', `/api/leave-requests/${id}`, { as: who }));
      refuse('leave DELETE | request approved meanwhile | by requester', reply, 403);
      assert.equal(await count('leave_requests', 'id', id), 1);
      assert.equal(await annual(who.id), before);
      assert.ok(waited, 'the request should have been waiting on the leave row');
    });

    test('delete timesheet by its owner while the sheet is submitted meanwhile -> 400, sheet kept', async () => {
      const { id, pt } = await seedSheet('draft');
      await seedEntry(id);
      const { reply, waited } = await meetsStatusChange({ ...SUBMIT, params: [id] }, '%DELETE FROM timesheets%',
        () => api('DELETE', `/api/timesheets/${id}`, { as: pt }));
      refuse('timesheet DELETE | sheet submitted meanwhile | by pt', reply, 400);
      assert.equal(await count('timesheets', 'id', id), 1);
      assert.equal(await count('timesheet_entries', 'timesheet_id', id), 1);
      assert.ok(waited, 'the request should have been waiting on the timesheet row');
    });

    test('delete timesheet by the owner role while the sheet is approved meanwhile -> 400, sheet kept', async () => {
      const { id } = await seedSheet('draft');
      await seedEntry(id);
      const approve = { text: `UPDATE timesheets SET status = 'approved', approved_by = $2, approved_at = NOW() WHERE id = $1`, params: [id, env.people.owner.id] };
      const { reply, waited } = await meetsStatusChange(approve, '%DELETE FROM timesheets%',
        () => api('DELETE', `/api/timesheets/${id}`, { as: env.people.owner }));
      refuse('timesheet DELETE | sheet approved meanwhile | by owner', reply, 400);
      assert.equal(await count('timesheets', 'id', id), 1);
      assert.equal(await count('timesheet_entries', 'timesheet_id', id), 1);
      assert.ok(waited, 'the request should have been waiting on the timesheet row');
    });
  });

  describe('a request that meets a status change: cafes', () => {
    test('reject a pending cafe that is activated meanwhile -> 400, cafe and members kept', async () => {
      const { cafeId } = await newCafeWithOwner('pending', { active: false, pinSet: false });
      const activate = { text: `UPDATE cafes SET status = 'active' WHERE id = $1`, params: [cafeId] };
      const { reply, waited } = await meetsStatusChange(activate, '%DELETE FROM cafes%',
        () => api('DELETE', `/api/super/cafes/${cafeId}/reject`, { as: env.people.super }));
      refuse('super reject | cafe activated meanwhile | by super', reply, 400);
      assert.equal((await byId('cafes', cafeId))?.status, 'active');
      assert.equal(await count('cafe_memberships', 'cafe_id', cafeId), 1);
      assert.ok(waited, 'the request should have been waiting on the cafe row');
    });

    test('suspend an active cafe that is suspended meanwhile -> 400, the first suspension stamp kept', async () => {
      const { cafeId } = await newCafeWithOwner('active');
      const suspend = { text: `UPDATE cafes SET status = 'suspended', admin_suspended_at = NOW() - INTERVAL '1 day' WHERE id = $1`, params: [cafeId] };
      const { reply, waited } = await meetsStatusChange(suspend, '%UPDATE cafes%',
        () => api('POST', `/api/super/cafes/${cafeId}/suspend`, { as: env.people.super }));
      refuse('super suspend | cafe suspended meanwhile | by super', reply, 400);
      const old = await row(`SELECT admin_suspended_at < NOW() - INTERVAL '23 hours' AS old FROM cafes WHERE id = $1`, [cafeId]);
      assert.equal(old?.old, true, 'the stamp from the first suspension is not rewritten');
      assert.ok(waited, 'the request should have been waiting on the cafe row');
    });
  });

  describe('cafe status: suspend and reject, one request at a time', () => {
    for (const status of ['pending', 'suspended'] as const) {
      test(`suspend a ${status} cafe -> 400, status kept`, async () => {
        const { cafeId } = await newCafeWithOwner(status);
        const r = await api('POST', `/api/super/cafes/${cafeId}/suspend`, { as: env.people.super });
        refuse(`super suspend | from ${status} | by super`, r, 400);
        assert.equal((await byId('cafes', cafeId))?.status, status);
      });
    }

    test('reject with a malformed id -> 400', async () => {
      refuse('super reject | malformed id | by super', await api('DELETE', '/api/super/cafes/nope/reject', { as: env.people.super }), 400);
    });
  });
}
