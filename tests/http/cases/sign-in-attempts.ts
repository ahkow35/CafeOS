/**
 * Sign-in attempt counting, for the two places that check a PIN against a profile:
 * POST /api/auth/login and POST /api/auth/change-pin (the current-PIN check).
 *
 * Part one pins what happens one request at a time. Part two sends many attempts at
 * the same moment and checks every attempt is counted, so no more than the allowed
 * number are compared before the account locks.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, newMember, row, PIN, type Person, type Reply } from '../harness';
import { expectStatus } from './util';

const WRONG = '135792';
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

async function expireLock(p: Person): Promise<void> {
  await row(`UPDATE profiles SET locked_until = NOW() - INTERVAL '1 minute' WHERE id = $1`, [p.id]);
}

export function signInAttemptCases(): void {
  describe('sign-in attempts: one at a time, login', () => {
    test('each wrong PIN adds one; the 5th locks for 15 minutes', async () => {
      const m = await newMember('staff');
      for (let i = 1; i <= 4; i++) {
        const r = await loginAs(m, WRONG);
        expectStatus(r, 401);
        assert.deepEqual(r.json, { error: 'Invalid phone or PIN', code: 'invalid_credentials' });
        const c = await counters(m);
        assert.equal(c.failed_attempts, i);
        assert.equal(c.locked_until, null);
      }
      const fifth = await loginAs(m, WRONG);
      expectStatus(fifth, 423);
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
      expectStatus(r, 423);
      assert.equal(r.json.code, 'locked');
      const c = await counters(b);
      assert.equal(c.failed_attempts, 6);
      assertLockedForFifteenMinutes(c);
    });

    test('an unknown phone is answered as a wrong PIN', async () => {
      const r = await api('POST', '/api/auth/login', { body: { phone: '+6580099999', pin: WRONG } });
      expectStatus(r, 401);
      assert.deepEqual(r.json, { error: 'Invalid phone or PIN', code: 'invalid_credentials' });
    });

    test('a disabled account is refused before the PIN is looked at, and is not counted, locked or not', async () => {
      const m = await newMember('staff');
      await row(`UPDATE profiles SET is_active = FALSE WHERE id = $1`, [m.id]);
      const r = await loginAs(m, WRONG);
      expectStatus(r, 403);
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
        expectStatus(r, 400);
        assert.deepEqual(r.json, { error: CP_WRONG });
        const c = await counters(m);
        assert.equal(c.failed_attempts, i);
        assert.equal(c.locked_until, null);
      }
      const fifth = await changePin(m, WRONG);
      expectStatus(fifth, 423);
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
      expectStatus(r, 423);
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
      expectStatus(r, 423);
      assert.deepEqual(r.json, { error: CP_LOCKED_NOW });
      const c = await counters(m);
      assert.equal(c.failed_attempts, 6);
      assertLockedForFifteenMinutes(c);
    });

    test('a badly formed current PIN is refused before it is counted', async () => {
      const m = await newMember('staff');
      await m.cookie();
      const r = await changePin(m, '12');
      expectStatus(r, 400);
      assert.equal((await counters(m)).failed_attempts, 0);
    });
  });

  describe('sign-in attempts: many at the same moment', () => {
    const SENT = 12;

    test('login: attempts sent together are each counted, so at most 5 are answered as a wrong PIN', async () => {
      const m = await newMember('staff');
      const replies = await Promise.all(Array.from({ length: SENT }, () => loginAs(m, WRONG)));
      const wrong = replies.filter((r) => r.status === 401).length;
      const locked = replies.filter((r) => r.status === 423).length;
      const other = replies.map((r) => r.status).filter((s) => s !== 401 && s !== 423);
      const c = await counters(m);
      const seen = `answered as wrong PIN: ${wrong}, as locked: ${locked}, other: ${JSON.stringify(other)}, failed_attempts: ${c.failed_attempts}`;
      assert.equal(wrong + locked, SENT, seen);
      assert.ok(wrong <= 5, `at most 5 should be answered as a wrong PIN; ${seen}`);
      assert.ok(c.failed_attempts >= 5, `failed_attempts should be at least 5; ${seen}`);
      assert.ok(c.secs !== null && c.secs > 0, `locked_until should be in the future; ${seen}`);
    });

    test('change PIN: attempts sent together are each counted, so at most 5 are answered as a wrong PIN', async () => {
      const m = await newMember('staff');
      await m.cookie();
      const replies = await Promise.all(Array.from({ length: SENT }, () => changePin(m, WRONG)));
      const wrong = replies.filter((r) => r.status === 400).length;
      const locked = replies.filter((r) => r.status === 423).length;
      const other = replies.map((r) => r.status).filter((s) => s !== 400 && s !== 423);
      const c = await counters(m);
      const seen = `answered as wrong PIN: ${wrong}, as locked: ${locked}, other: ${JSON.stringify(other)}, failed_attempts: ${c.failed_attempts}`;
      assert.equal(wrong + locked, SENT, seen);
      assert.ok(wrong <= 5, `at most 5 should be answered as a wrong PIN; ${seen}`);
      assert.ok(c.failed_attempts >= 5, `failed_attempts should be at least 5; ${seen}`);
      assert.ok(c.secs !== null && c.secs > 0, `locked_until should be in the future; ${seen}`);
    });
  });
}
