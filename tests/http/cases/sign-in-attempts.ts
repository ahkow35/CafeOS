/**
 * Sign-in attempt counting, for the two places that check a PIN against a profile:
 * POST /api/auth/login and POST /api/auth/change-pin (the current-PIN check).
 *
 * Part one pins what happens one request at a time. Part two sends many attempts at
 * the same moment and pins the replies and the stored count.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, env, newMember, row, PIN, type Person, type Reply } from '../harness';
import { expectStatus, refuse } from './util';

const WRONG = '135792';
const THRESHOLD = 5; // wrong attempts that lock the account
const LOCK_MESSAGE = 'Too many wrong attempts. Try again in 15 minutes.';
const CP_WRONG = 'Your current PIN is incorrect.';
const CP_LOCKED_NOW = 'Too many incorrect attempts. Try again in 15 minutes.';
const CP_LOCKED = 'Too many incorrect attempts. Try again later.';

const loginAs = (p: Person, pin: string): Promise<Reply> =>
  api('POST', '/api/auth/login', { body: { phone: p.phone, pin } });

const changePin = (p: Person, currentPin: string, newPin = '864209'): Promise<Reply> =>
  api('POST', '/api/auth/change-pin', { as: p, body: { currentPin, newPin } });

async function counters(p: Person) {
  const r = await row<{ failed_attempts: number; locked_until: Date | null; secs: number | null }>(
    `SELECT failed_attempts, locked_until,
            EXTRACT(EPOCH FROM (locked_until - NOW()))::float8 AS secs
       FROM profiles WHERE id = $1`,
    [p.id],
  );
  assert.ok(r, 'profile should exist');
  return r;
}

/** locked_until is about 15 minutes from now (allowing a little clock movement). */
function assertLockedForFifteenMinutes(c: { secs: number | null }): void {
  assert.ok(c.secs !== null && c.secs > 14 * 60 && c.secs <= 15 * 60 + 5, `locked_until should be about 15 minutes ahead, got ${c.secs}s`);
}

/**
 * One count away from the lock, the profile row held by this test's own connection, then `sent`
 * right-PIN requests queue on it. When the row is released the first request takes the last count and
 * the lock, and the requests behind it find the account locked. The reply split depends on how fast the
 * first request clears the count afterwards, so the cases below assert a bound (at least one let in, at
 * least one told locked), not an exact split.
 */
async function rightPinsQueuedOnOneRow(p: Person, send: () => Promise<Reply>, sent: number): Promise<Reply[]> {
  await row(`UPDATE profiles SET failed_attempts = ${THRESHOLD - 1}, locked_until = NULL WHERE id = $1`, [p.id]);
  const holder = await env.pool.connect();
  let replies: Promise<Reply[]>;
  try {
    await holder.query('BEGIN');
    await holder.query(`SELECT id FROM profiles WHERE id = $1 FOR UPDATE`, [p.id]);
    replies = Promise.all(Array.from({ length: sent }, send));
    const deadline = Date.now() + 20_000;
    for (;;) {
      const waiting = await row<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%UPDATE profiles%'`);
      if (waiting?.n === sent) break;
      assert.ok(Date.now() < deadline, `all ${sent} requests should be waiting on the row, ${waiting?.n} were`);
      await new Promise((r) => setTimeout(r, 50));
    }
    await holder.query('COMMIT');
  } catch (e) {
    await holder.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    holder.release();
  }
  return replies;
}

async function expireLock(p: Person): Promise<void> {
  await row(`UPDATE profiles SET locked_until = NOW() - INTERVAL '1 minute' WHERE id = $1`, [p.id]);
}

export function signInAttemptCases(): void {
  describe('sign-in attempts: one at a time, login', () => {
    test('each wrong PIN adds one; the 5th locks for 15 minutes', async () => {
      const m = await newMember('staff');
      for (let i = 1; i <= 4; i++) {
        const r = await loginAs(m, WRONG);
        if (i === 1) refuse('sign in | wrong PIN', r, 401); else expectStatus(r, 401);
        assert.deepEqual(r.json, { error: 'Invalid phone or PIN', code: 'invalid_credentials' });
        const c = await counters(m);
        assert.equal(c.failed_attempts, i);
        assert.equal(c.locked_until, null);
      }
      const fifth = await loginAs(m, WRONG);
      refuse('sign in | fifth wrong PIN locks', fifth, 423);
      assert.deepEqual(fifth.json, { error: LOCK_MESSAGE, code: 'locked' });
      const c = await counters(m);
      assert.equal(c.failed_attempts, 5);
      assertLockedForFifteenMinutes(c);
    });

    test('a locked account is refused even with the right PIN, and nothing changes', async () => {
      const m = await newMember('staff');
      for (let i = 0; i < 5; i++) await loginAs(m, WRONG);
      const before = await counters(m);
      const r = await loginAs(m, PIN);
      expectStatus(r, 423);
      assert.equal(r.json.code, 'locked');
      assert.match(r.json.error, /^Too many wrong attempts\. Try again at .+\.$/);
      const after = await counters(m);
      assert.equal(after.failed_attempts, before.failed_attempts);
      assert.equal(after.locked_until?.getTime(), before.locked_until?.getTime());
    });

    test('a right PIN before the lock resets the count to 0', async () => {
      const m = await newMember('staff');
      for (let i = 0; i < 3; i++) await loginAs(m, WRONG);
      assert.equal((await counters(m)).failed_attempts, 3);
      expectStatus(await loginAs(m, PIN), 200);
      const c = await counters(m);
      assert.equal(c.failed_attempts, 0);
      assert.equal(c.locked_until, null);
    });

    test('once the lock has run out a right PIN signs in and resets; a wrong PIN locks again (count is not reset)', async () => {
      const a = await newMember('staff');
      for (let i = 0; i < 5; i++) await loginAs(a, WRONG);
      await expireLock(a);
      expectStatus(await loginAs(a, PIN), 200);
      assert.deepEqual([(await counters(a)).failed_attempts, (await counters(a)).locked_until], [0, null]);

      const b = await newMember('staff');
      for (let i = 0; i < 5; i++) await loginAs(b, WRONG);
      await expireLock(b);
      const r = await loginAs(b, WRONG);
      refuse('sign in | wrong PIN after the lock ran out', r, 423);
      assert.equal(r.json.code, 'locked');
      const c = await counters(b);
      assert.equal(c.failed_attempts, 6);
      assertLockedForFifteenMinutes(c);
    });

    test('an unknown phone is answered as a wrong PIN', async () => {
      const r = await api('POST', '/api/auth/login', { body: { phone: '+6580099999', pin: WRONG } });
      refuse('sign in | unknown phone', r, 401);
      assert.deepEqual(r.json, { error: 'Invalid phone or PIN', code: 'invalid_credentials' });
    });

    test('a disabled account is refused before the PIN is looked at, and is not counted, locked or not', async () => {
      const m = await newMember('staff');
      await row(`UPDATE profiles SET is_active = FALSE WHERE id = $1`, [m.id]);
      const r = await loginAs(m, WRONG);
      refuse('sign in | disabled account', r, 403);
      assert.deepEqual(r.json, { error: 'This account is disabled. Contact your manager.', code: 'inactive' });
      assert.equal((await counters(m)).failed_attempts, 0);
      await row(`UPDATE profiles SET failed_attempts = 5, locked_until = NOW() + INTERVAL '10 minutes' WHERE id = $1`, [m.id]);
      const again = await loginAs(m, PIN);
      expectStatus(again, 403);
      assert.equal(again.json.code, 'inactive');
      assert.equal((await counters(m)).failed_attempts, 5);
    });
  });

  describe('sign-in attempts: one at a time, change PIN', () => {
    test('each wrong current PIN adds one; the 5th locks for 15 minutes', async () => {
      const m = await newMember('staff');
      await m.cookie();
      for (let i = 1; i <= 4; i++) {
        const r = await changePin(m, WRONG);
        if (i === 1) refuse('change PIN | wrong current PIN', r, 400); else expectStatus(r, 400);
        assert.deepEqual(r.json, { error: CP_WRONG });
        const c = await counters(m);
        assert.equal(c.failed_attempts, i);
        assert.equal(c.locked_until, null);
      }
      const fifth = await changePin(m, WRONG);
      refuse('change PIN | fifth wrong current PIN locks', fifth, 423);
      assert.deepEqual(fifth.json, { error: CP_LOCKED_NOW });
      const c = await counters(m);
      assert.equal(c.failed_attempts, 5);
      assertLockedForFifteenMinutes(c);
    });

    test('a locked account is refused even with the right current PIN, and nothing changes', async () => {
      const m = await newMember('staff');
      await m.cookie();
      for (let i = 0; i < 5; i++) await changePin(m, WRONG);
      const before = await counters(m);
      const r = await changePin(m, PIN);
      refuse('change PIN | locked, right current PIN', r, 423);
      assert.deepEqual(r.json, { error: CP_LOCKED });
      const after = await counters(m);
      assert.equal(after.failed_attempts, before.failed_attempts);
      assert.equal(after.locked_until?.getTime(), before.locked_until?.getTime());
    });

    test('a right current PIN before the lock changes the PIN and the count ends at 0', async () => {
      const m = await newMember('staff');
      await m.cookie();
      for (let i = 0; i < 3; i++) await changePin(m, WRONG);
      assert.equal((await counters(m)).failed_attempts, 3);
      const r = await changePin(m, PIN);
      expectStatus(r, 200);
      assert.deepEqual(r.json, { ok: true });
      const c = await counters(m);
      assert.equal(c.failed_attempts, 0);
      assert.equal(c.locked_until, null);
    });

    test('once the lock has run out a wrong current PIN locks again (count is not reset)', async () => {
      const m = await newMember('staff');
      await m.cookie();
      for (let i = 0; i < 5; i++) await changePin(m, WRONG);
      await expireLock(m);
      const r = await changePin(m, WRONG);
      refuse('change PIN | wrong current PIN after the lock ran out', r, 423);
      assert.deepEqual(r.json, { error: CP_LOCKED_NOW });
      const c = await counters(m);
      assert.equal(c.failed_attempts, 6);
      assertLockedForFifteenMinutes(c);
    });

    test('a badly formed current PIN is refused before it is counted', async () => {
      const m = await newMember('staff');
      await m.cookie();
      const r = await changePin(m, '12');
      refuse('change PIN | badly formed current PIN', r, 400);
      assert.equal((await counters(m)).failed_attempts, 0);
    });
  });

  describe('sign-in attempts: many at the same moment', () => {
    const SENT = 12;

    test('login: 12 wrong PINs at once give 4 wrong-PIN replies, then locked', async () => {
      const m = await newMember('staff');
      const replies = await Promise.all(Array.from({ length: SENT }, () => loginAs(m, WRONG)));
      const wrong = replies.filter((r) => r.status === 401).length;
      const locked = replies.filter((r) => r.status === 423).length;
      const other = replies.map((r) => r.status).filter((s) => s !== 401 && s !== 423);
      const c = await counters(m);
      const seen = `answered as wrong PIN: ${wrong}, as locked: ${locked}, other: ${JSON.stringify(other)}, failed_attempts: ${c.failed_attempts}`;
      assert.equal(wrong + locked, SENT, seen);
      assert.equal(wrong, 4, `4 should be answered as a wrong PIN; ${seen}`);
      assert.equal(c.failed_attempts, 5, `failed_attempts should be 5; ${seen}`);
      assert.ok(c.secs !== null && c.secs > 0, `locked_until should be in the future; ${seen}`);
    });

    test('change PIN: 12 wrong PINs at once give 4 wrong-PIN replies, then locked', async () => {
      const m = await newMember('staff');
      await m.cookie();
      const replies = await Promise.all(Array.from({ length: SENT }, () => changePin(m, WRONG)));
      const wrong = replies.filter((r) => r.status === 400).length;
      const locked = replies.filter((r) => r.status === 423).length;
      const other = replies.map((r) => r.status).filter((s) => s !== 400 && s !== 423);
      const c = await counters(m);
      const seen = `answered as wrong PIN: ${wrong}, as locked: ${locked}, other: ${JSON.stringify(other)}, failed_attempts: ${c.failed_attempts}`;
      assert.equal(wrong + locked, SENT, seen);
      assert.equal(wrong, 4, `4 should be answered as a wrong PIN; ${seen}`);
      assert.equal(c.failed_attempts, 5, `failed_attempts should be 5; ${seen}`);
      assert.ok(c.secs !== null && c.secs > 0, `locked_until should be in the future; ${seen}`);
    });

    test('login: right PINs sent at once with one count left are not all let in; the others are told locked', async () => {
      const m = await newMember('staff');
      const replies = await rightPinsQueuedOnOneRow(m, () => loginAs(m, PIN), 6);
      const statuses = replies.map((r) => r.status).sort();
      const [letIn, locked] = [200, 423].map((s) => statuses.filter((x) => x === s).length);
      assert.ok(letIn >= 1 && locked >= 1 && letIn + locked === 6, `statuses: ${statuses.join(',')}`);
      for (const r of replies.filter((x) => x.status === 423)) assert.equal(r.json.code, 'locked');
      await row(`UPDATE profiles SET failed_attempts = 0, locked_until = NULL WHERE id = $1`, [m.id]);
    });

    test('change PIN: right current PINs sent at once with one count left are not all let in; the others are told locked', async () => {
      const m = await newMember('staff');
      await m.cookie();
      const replies = await rightPinsQueuedOnOneRow(m, () => changePin(m, PIN), 6);
      const statuses = replies.map((r) => r.status).sort();
      const [letIn, locked] = [200, 423].map((s) => statuses.filter((x) => x === s).length);
      assert.ok(letIn >= 1 && locked >= 1 && letIn + locked === 6, `statuses: ${statuses.join(',')}`);
      for (const r of replies.filter((x) => x.status === 423)) assert.deepEqual(r.json, { error: CP_LOCKED });
      await row(`UPDATE profiles SET failed_attempts = 0, locked_until = NULL WHERE id = $1`, [m.id]);
    });
  });
}
