/**
 * The four routes that store a new PIN for a profile: change PIN, reset with a code, the owner's
 * reset of a staff PIN, and approving a cafe whose owner is issued a first PIN. For each one the
 * stored columns after the write are pinned, plus what an earlier session cookie and the new PIN do.
 * The refusals of these routes are pinned too.
 *
 * pin_set_at: the test schema (db/schema.sql) has no trigger on pin_hash, so the pin_set_at
 * assertions below describe this test database only.
 */
import { createHmac } from 'node:crypto';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, env, newCafeWithOwner, newMember, row, serverJwtSecret, PIN, type Person, type Reply } from '../harness';
import { expectStatus, refuse } from './util';

const NEW_PIN = '864209';

const loginAs = (p: { phone: string }, pin: string): Promise<Reply> =>
  api('POST', '/api/auth/login', { body: { phone: p.phone, pin } });

interface Stored {
  failed_attempts: number;
  locked_until: Date | null;
  token_version: number;
  pin_set_at: Date | null;
  is_active: boolean;
  pin_hash: string;
}

async function stored(id: string): Promise<Stored> {
  const r = await row<Stored>(
    `SELECT failed_attempts, locked_until, token_version, pin_set_at, is_active, pin_hash FROM profiles WHERE id = $1`, [id]);
  assert.ok(r, 'profile should exist');
  return r;
}

const time = (d: Date | null): number | null => (d ? d.getTime() : null);

/** A session cookie from before the write is refused afterwards (the session counter moved). */
async function expectOldSessionRefused(key: string, oldCookie: string): Promise<void> {
  const r = await api('GET', '/api/tasks', { cookie: oldCookie });
  refuse(key, r, 401);
  assert.equal(r.json.error, 'Your session has expired. Please sign in again.');
}

async function addResetToken(userId: string, phone: string, code: string, o: { minutes?: number; used?: boolean; attempts?: number } = {}) {
  const hash = createHmac('sha256', serverJwtSecret()).update(`pin-reset:${phone}:${code}`).digest('hex');
  const r = await row<{ id: string }>(
    `INSERT INTO pin_reset_tokens (user_id, code_hash, request_ip_hash, attempts_remaining, expires_at, used_at)
     VALUES ($1, $2, 'test', $3, NOW() + make_interval(mins => $4), CASE WHEN $5::boolean THEN NOW() ELSE NULL END)
     RETURNING id`,
    [userId, hash, o.attempts ?? 5, o.minutes ?? 10, o.used ?? false],
  );
  return r!.id;
}

const tokenOf = (id: string) =>
  row<{ used_at: Date | null; attempts_remaining: number }>(`SELECT used_at, attempts_remaining FROM pin_reset_tokens WHERE id = $1`, [id]);

const confirm = (phone: string, code: string, newPin: string): Promise<Reply> =>
  api('POST', '/api/auth/pin-reset/confirm', { body: { phone, code, newPin } });

const resetPin = (target: string, as: Person | null, body?: unknown): Promise<Reply> =>
  api('POST', `/api/admin/users/${target}/reset-pin`, { as, body });

const approve = (cafeId: string): Promise<Reply> => api('POST', `/api/super/cafes/${cafeId}/approve`, { as: env.people.super });

function clearsSession(r: Reply): void {
  const cookies = r.headers.getSetCookie();
  assert.ok(cookies.some((c) => /^cafeos_session=;/.test(c) && /Max-Age=0/i.test(c)), `session cookie should be cleared: ${cookies.join(' | ')}`);
}

export function pinWriteCases(): void {
  describe('PIN write: change PIN', () => {
    test('stored columns, other sessions, reset codes and the new PIN after a change', async () => {
      const m = await newMember('staff');
      const old = await m.cookie();
      // A lock that has run out (a live lock would refuse the request itself); the count is 3.
      await row(`UPDATE profiles SET failed_attempts = 3, locked_until = NOW() - INTERVAL '1 minute' WHERE id = $1`, [m.id]);
      const token = await addResetToken(m.id, m.phone, '123456');
      const before = await stored(m.id);
      assert.equal(before.failed_attempts, 3);

      const r = await api('POST', '/api/auth/change-pin', { as: m, body: { currentPin: PIN, newPin: NEW_PIN } });
      expectStatus(r, 200);
      assert.deepEqual(r.json, { ok: true });
      clearsSession(r);

      const after = await stored(m.id);
      assert.equal(after.failed_attempts, 0);
      assert.equal(after.locked_until, null);
      assert.equal(after.token_version, before.token_version + 1);
      assert.equal(time(after.pin_set_at), time(before.pin_set_at), 'pin_set_at is not written by this route');
      assert.equal(after.is_active, true);
      assert.notEqual(after.pin_hash, before.pin_hash);
      assert.ok((await tokenOf(token))?.used_at, 'open reset codes are marked used');

      await expectOldSessionRefused('PIN write | change PIN | session from before the change', old);
      expectStatus(await loginAs(m, NEW_PIN), 200);
    });

    test('refusals: signed out, bad body, easy new PIN', async () => {
      const m = await newMember('staff');
      refuse('change PIN | signed out', await api('POST', '/api/auth/change-pin', { body: { currentPin: PIN, newPin: NEW_PIN } }), 401);
      refuse('change PIN | bad JSON', await api('POST', '/api/auth/change-pin', { as: m, raw: '{' }), 400);
      refuse('change PIN | missing PINs', await api('POST', '/api/auth/change-pin', { as: m, body: {} }), 400);
      refuse('change PIN | new PIN with repeated digits', await api('POST', '/api/auth/change-pin', { as: m, body: { currentPin: PIN, newPin: '111111' } }), 400);
      assert.equal((await stored(m.id)).failed_attempts, 0);
    });
  });

  describe('PIN write: reset with a code', () => {
    test('stored columns, other sessions, the code and the new PIN after a reset', async () => {
      const m = await newMember('staff');
      const old = await m.cookie();
      await row(`UPDATE profiles SET failed_attempts = 3, locked_until = NOW() + INTERVAL '10 minutes' WHERE id = $1`, [m.id]);
      const token = await addResetToken(m.id, m.phone, '123456');
      const before = await stored(m.id);

      const r = await confirm(m.phone, '123456', NEW_PIN);
      expectStatus(r, 200);
      assert.deepEqual(r.json, { ok: true });
      clearsSession(r);

      const after = await stored(m.id);
      assert.equal(after.failed_attempts, 0);
      assert.equal(after.locked_until, null);
      assert.equal(after.token_version, before.token_version + 1);
      assert.equal(time(after.pin_set_at), time(before.pin_set_at), 'pin_set_at is not written by this route');
      assert.equal(after.is_active, true);
      assert.notEqual(after.pin_hash, before.pin_hash);
      assert.ok((await tokenOf(token))?.used_at, 'the code is marked used');

      await expectOldSessionRefused('PIN write | reset with a code | session from before the reset', old);
      expectStatus(await loginAs(m, NEW_PIN), 200);
    });

    test('refusals', async () => {
      const m = await newMember('staff');
      refuse('reset with a code | bad JSON', await api('POST', '/api/auth/pin-reset/confirm', { raw: '{' }), 400);
      refuse('reset with a code | bad phone', await confirm('abc', '123456', NEW_PIN), 400);
      refuse('reset with a code | bad code', await confirm(m.phone, '12', NEW_PIN), 400);
      refuse('reset with a code | easy new PIN', await confirm(m.phone, '123456', '111111'), 400);
      refuse('reset with a code | no code was requested', await confirm(m.phone, '123456', NEW_PIN), 400);

      const wrong = await addResetToken(m.id, m.phone, '123456');
      refuse('reset with a code | wrong code', await confirm(m.phone, '654321', NEW_PIN), 400);
      assert.equal((await tokenOf(wrong))?.attempts_remaining, 4);
      assert.equal((await tokenOf(wrong))?.used_at, null);

      const sameAsCurrent = await confirm(m.phone, '123456', PIN);
      refuse('reset with a code | new PIN equals the current PIN', sameAsCurrent, 400);
      assert.equal((await tokenOf(wrong))?.used_at, null, 'a refused reset does not use the code');
      assert.equal((await stored(m.id)).token_version, 0);
    });

    test('refusals: expired, used and exhausted codes', async () => {
      const a = await newMember('staff');
      await addResetToken(a.id, a.phone, '123456', { minutes: -1 });
      refuse('reset with a code | code expired', await confirm(a.phone, '123456', NEW_PIN), 400);
      const b = await newMember('staff');
      await addResetToken(b.id, b.phone, '123456', { used: true });
      refuse('reset with a code | code already used', await confirm(b.phone, '123456', NEW_PIN), 400);
      const c = await newMember('staff');
      const last = await addResetToken(c.id, c.phone, '123456', { attempts: 1 });
      expectStatus(await confirm(c.phone, '654321', NEW_PIN), 400);
      assert.ok((await tokenOf(last))?.used_at, 'the last wrong attempt uses the code up');
      assert.equal((await stored(a.id)).token_version + (await stored(b.id)).token_version + (await stored(c.id)).token_version, 0);
    });
  });

  describe('PIN write: owner resets a staff PIN', () => {
    test('stored columns, other sessions and the chosen PIN after a reset', async () => {
      const staff = await newMember('staff');
      const old = await staff.cookie();
      await row(`UPDATE profiles SET failed_attempts = 3, locked_until = NOW() + INTERVAL '10 minutes' WHERE id = $1`, [staff.id]);
      const before = await stored(staff.id);

      const r = await resetPin(staff.id, env.people.owner, { pin: NEW_PIN });
      expectStatus(r, 200);
      assert.deepEqual(r.json, { tempPin: NEW_PIN });

      const after = await stored(staff.id);
      assert.equal(after.failed_attempts, 0);
      assert.equal(after.locked_until, null);
      assert.equal(after.token_version, before.token_version + 1);
      assert.equal(time(after.pin_set_at), time(before.pin_set_at), 'pin_set_at is not written by this route');
      assert.equal(after.is_active, true);
      assert.notEqual(after.pin_hash, before.pin_hash);

      await expectOldSessionRefused('PIN write | owner reset | session from before the reset', old);
      expectStatus(await loginAs(staff, NEW_PIN), 200);
    });

    test('with no PIN in the request one is generated and works', async () => {
      const staff = await newMember('staff');
      const r = await resetPin(staff.id, env.people.owner);
      expectStatus(r, 200);
      assert.match(r.json.tempPin, /^\d{6}$/);
      expectStatus(await loginAs(staff, r.json.tempPin), 200);
      assert.equal((await stored(staff.id)).token_version, 1);
    });

    test('a disabled account stays disabled', async () => {
      const staff = await newMember('staff');
      await row(`UPDATE profiles SET is_active = FALSE WHERE id = $1`, [staff.id]);
      expectStatus(await resetPin(staff.id, env.people.owner, { pin: NEW_PIN }), 200);
      const after = await stored(staff.id);
      assert.equal(after.is_active, false);
      assert.equal(after.token_version, 1);
    });

    test('refusals', async () => {
      const staff = await newMember('staff');
      const other = await newMember('staff', env.cafe2);
      refuse('owner reset PIN | signed out', await resetPin(staff.id, null), 401);
      refuse('owner reset PIN | by staff', await resetPin(staff.id, env.people.staff), 403);
      refuse('owner reset PIN | malformed user id', await resetPin('x', env.people.owner), 400);
      refuse('owner reset PIN | user not in this cafe', await resetPin(other.id, env.people.owner), 404);
      refuse('owner reset PIN | user in other cafes too', await resetPin(env.people.multi.id, env.people.owner), 409);
      refuse('owner reset PIN | bad JSON', await api('POST', `/api/admin/users/${staff.id}/reset-pin`, { as: env.people.owner, raw: '{' }), 400);
      refuse('owner reset PIN | bad PIN', await resetPin(staff.id, env.people.owner, { pin: '12' }), 400);
      for (const p of [staff, other, env.people.multi]) assert.equal((await stored(p.id)).token_version, 0);
    });
  });

  describe('PIN write: cafe approval issues an owner PIN', () => {
    /** A pending cafe whose owner has held one session, then is back to the not-yet-active state. */
    async function pendingOwner(lock: 'none' | 'expired' | 'future') {
      const { cafeId, owner } = await newCafeWithOwner('pending', { active: false, pinSet: false });
      await row(`UPDATE profiles SET is_active = TRUE WHERE id = $1`, [owner.id]);
      await row(`UPDATE cafes SET status = 'active' WHERE id = $1`, [cafeId]);
      await row(`UPDATE cafe_memberships SET status = 'active' WHERE cafe_id = $1`, [cafeId]);
      const old = await owner.cookie();
      await row(`UPDATE profiles SET is_active = FALSE WHERE id = $1`, [owner.id]);
      await row(`UPDATE cafes SET status = 'pending' WHERE id = $1`, [cafeId]);
      await row(`UPDATE cafe_memberships SET status = 'pending' WHERE cafe_id = $1`, [cafeId]);
      if (lock !== 'none') {
        const until = lock === 'expired' ? `NOW() - INTERVAL '1 minute'` : `NOW() + INTERVAL '10 minutes'`;
        await row(`UPDATE profiles SET failed_attempts = 3, locked_until = ${until} WHERE id = $1`, [owner.id]);
      }
      return { cafeId, owner, old };
    }

    test('the owner is activated and issued a PIN; the attempt count and an expired lock stay as they were', async () => {
      const { cafeId, owner, old } = await pendingOwner('expired');
      const before = await stored(owner.id);
      assert.equal(before.pin_set_at, null);
      assert.equal(before.is_active, false);

      const r = await approve(cafeId);
      expectStatus(r, 200);
      assert.match(r.json.pin, /^\d{6}$/);

      const after = await stored(owner.id);
      assert.equal(after.failed_attempts, 3);
      assert.equal(time(after.locked_until), time(before.locked_until));
      assert.equal(after.token_version, before.token_version + 1);
      assert.ok(after.pin_set_at, 'pin_set_at is set by the write itself (the test schema has no trigger on pin_hash)');
      assert.equal(after.is_active, true);
      assert.notEqual(after.pin_hash, before.pin_hash);

      await expectOldSessionRefused('PIN write | approve | session from before the approval', old);
      expectStatus(await loginAs(owner, r.json.pin), 200);
    });

    test('a lock that has not run out is left in place and the new PIN is refused as locked', async () => {
      const { cafeId, owner } = await pendingOwner('future');
      const before = await stored(owner.id);
      const r = await approve(cafeId);
      expectStatus(r, 200);
      const after = await stored(owner.id);
      assert.equal(after.failed_attempts, 3);
      assert.equal(time(after.locked_until), time(before.locked_until));
      assert.ok(after.locked_until);
      const signIn = await loginAs(owner, r.json.pin);
      expectStatus(signIn, 423);
      assert.equal(signIn.json.code, 'locked');
    });

    test('an owner who keeps their PIN has no column written', async () => {
      const { cafeId, owner } = await newCafeWithOwner('pending', { active: true, pinSet: true });
      await row(`UPDATE profiles SET failed_attempts = 3, locked_until = NOW() + INTERVAL '10 minutes' WHERE id = $1`, [owner.id]);
      const before = await stored(owner.id);
      expectStatus(await approve(cafeId), 200);
      const after = await stored(owner.id);
      assert.deepEqual(
        [after.failed_attempts, time(after.locked_until), after.token_version, time(after.pin_set_at), after.is_active, after.pin_hash],
        [before.failed_attempts, time(before.locked_until), before.token_version, time(before.pin_set_at), before.is_active, before.pin_hash],
      );
    });
  });
}
