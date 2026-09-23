/**
 * DB-level tests for the instant café signup flow, run against a throwaway
 * Postgres seeded from db/schema.sql. Skipped unless TEST_DATABASE_URL is set.
 *
 * Unlike tests/db/claims-sql.test.ts (which mirrors route SQL as strings),
 * these import the REAL functions from src/lib/instantSignup.ts — that module
 * is deliberately dependency-light (no next/headers, no @vercel/postgres) so
 * it can run here against a plain `pg` client instead of Neon's HTTP-only
 * driver. Stripe is stubbed via dependency injection (ProvisionDeps.createTrial)
 * — this file never imports src/lib/billing.ts and never calls the real
 * Stripe API.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Pool, type PoolClient } from 'pg';
import {
  bindSignupToken,
  checkAndRecordBotAttempt,
  checkSignupIpRateLimit,
  checkSignupPhoneRateLimit,
  cleanupExpiredSignupsForPhone,
  consumePinSetToken,
  decideSignupEligibility,
  findEligibleSignupForUser,
  generatePinSetToken,
  generateSignupToken,
  hasOtherSignupForPhone,
  hashPinSetToken,
  hashSignupToken,
  insertPinSetToken,
  insertSignup,
  phoneHasProfile,
  provisionPhase1,
  provisionPhase2,
  telegramAlreadyLinkedToProfile,
  type Queryable,
  type CreateTrialFn,
} from '../../src/lib/instantSignup';

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL not set';

const pool = url ? new Pool({ connectionString: url }) : null;

function asQueryable(client: PoolClient): Queryable {
  return { query: (text, params) => client.query(text, params as unknown[]) as never };
}

async function q<T extends Record<string, unknown> = Record<string, unknown>>(text: string, params: unknown[] = []) {
  const r = await pool!.query(text, params);
  return r.rows as T[];
}

/** Runs `fn` inside its own BEGIN/COMMIT, mirroring withPlainTx's shape. */
async function withTx<T>(fn: (db: Queryable) => Promise<T>): Promise<T> {
  const client = await pool!.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(asQueryable(client));
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

let phoneCounter = 0;
function freshPhone(): string {
  phoneCounter += 1;
  return `+65900${String(phoneCounter).padStart(5, '0')}`;
}

const ipHash = 'ip-hash-fixture';

async function seedSignup(overrides: Partial<{ phone: string; ipHash: string; expiresInMinutes: number }> = {}) {
  const phone = overrides.phone ?? freshPhone();
  const token = generateSignupToken();
  const cafeId = (await q<{ id: string }>(`SELECT gen_random_uuid() AS id`))[0].id;
  const { id } = await withTx((db) =>
    insertSignup(db, {
      cafeId,
      cafeName: 'Test Cafe',
      ownerName: 'Test Owner',
      phoneE164: phone,
      email: null,
      tokenHash: hashSignupToken(token),
      ipHash: overrides.ipHash ?? ipHash,
    }),
  );
  if (overrides.expiresInMinutes !== undefined) {
    await q(`UPDATE cafe_signups SET expires_at = NOW() + ($1 || ' minutes')::interval WHERE id = $2`, [
      overrides.expiresInMinutes,
      id,
    ]);
  }
  return { id, phone, token, cafeId };
}

describe('instant signup sql', { skip }, () => {
  // Only clean the tables this feature owns exclusively (nothing else in the
  // repo writes to cafe_signups/signup_bot_attempts/pin_set_tokens). Every test
  // below creates its own fresh phone number and cafe id, so nothing here needs
  // cafes/profiles/cafe_memberships wiped between tests — doing that would race
  // with tests/db/claims-sql.test.ts's fixtures, which run concurrently against
  // the same database and depend on rows in those shared tables surviving.
  before(async () => {
    await q(`DELETE FROM pin_set_tokens`);
    await q(`DELETE FROM signup_bot_attempts`);
    await q(`DELETE FROM cafe_signups`);
  });

  after(async () => {
    await pool?.end();
  });

  test('DB-enforced: at most one open signup per phone (partial unique index)', async () => {
    const phone = freshPhone();
    await seedSignup({ phone });
    await assert.rejects(seedSignup({ phone }), /idx_cafe_signups_open_phone|duplicate key/i);
    const rows = await q(`SELECT id FROM cafe_signups WHERE phone_e164 = $1`, [phone]);
    assert.equal(rows.length, 1);
  });

  test('token is single-use: binding twice fails the second time', async () => {
    const { token } = await seedSignup();
    const first = await withTx((db) => bindSignupToken(db, hashSignupToken(token), 111));
    assert.equal(first.ok, true);
    const second = await withTx((db) => bindSignupToken(db, hashSignupToken(token), 111));
    assert.equal(second.ok, false);
  });

  test('expired token is rejected at bind time', async () => {
    const { token, id } = await seedSignup();
    await q(`UPDATE cafe_signups SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [id]);
    const bound = await withTx((db) => bindSignupToken(db, hashSignupToken(token), 222));
    assert.equal(bound.ok, false);
  });

  test('cleanupExpiredSignupsForPhone removes only expired pending/verified rows, never provisioned', async () => {
    const phone = freshPhone();
    const expired = await seedSignup({ phone, expiresInMinutes: -1 });
    await withTx((db) => cleanupExpiredSignupsForPhone(db, phone));
    assert.equal((await q(`SELECT id FROM cafe_signups WHERE id = $1`, [expired.id])).length, 0);

    const provisioned = await seedSignup({ phone, expiresInMinutes: -1 });
    await q(`UPDATE cafe_signups SET status = 'provisioned' WHERE id = $1`, [provisioned.id]);
    await withTx((db) => cleanupExpiredSignupsForPhone(db, phone));
    assert.equal((await q(`SELECT id FROM cafe_signups WHERE id = $1`, [provisioned.id])).length, 1, 'provisioned rows are never deleted');
  });

  test('rate limit: IP limit trips after 5 signups in 10 minutes', async () => {
    const thisIp = `ip-${Date.now()}`;
    for (let i = 0; i < 5; i += 1) {
      await seedSignup({ ipHash: thisIp });
    }
    const ok = await withTx((db) => checkSignupIpRateLimit(db, thisIp));
    assert.equal(ok, false);
  });

  test('rate limit: phone limit trips after 3 signups in 1 hour', async () => {
    const phone = freshPhone();
    for (let i = 0; i < 3; i += 1) {
      const s = await seedSignup({ phone });
      // idx_cafe_signups_open_phone treats 'pending'/'verified'/'provisioned' as
      // still open, so only 'completed' frees the phone for the next iteration's
      // insert — we're testing the COUNT limit here, not the open-signup
      // constraint (covered by its own test above).
      await q(`UPDATE cafe_signups SET status = 'completed' WHERE id = $1`, [s.id]);
    }
    const ok = await withTx((db) => checkSignupPhoneRateLimit(db, phone));
    assert.equal(ok, false);
  });

  test('bot attempt rate limit: trips after the limit and records nothing once tripped', async () => {
    const telegramUserId = 90001;
    for (let i = 0; i < 10; i += 1) {
      const allowed = await withTx((db) => checkAndRecordBotAttempt(db, telegramUserId, 10, 10));
      assert.equal(allowed, true);
    }
    const blocked = await withTx((db) => checkAndRecordBotAttempt(db, telegramUserId, 10, 10));
    assert.equal(blocked, false);
    const rows = await q(`SELECT count(*)::int AS n FROM signup_bot_attempts WHERE telegram_user_id = $1`, [telegramUserId]);
    assert.equal(Number((rows[0] as { n: number }).n), 10, 'the 11th attempt must not be recorded');
  });

  test('existing-number is refused before any signup row is created', async () => {
    const phone = freshPhone();
    await q(`INSERT INTO profiles (phone_e164, full_name, pin_hash) VALUES ($1, 'Existing', 'x')`, [phone]);
    const hasProfile = await withTx((db) => phoneHasProfile(db, phone));
    assert.equal(hasProfile, true);
    const decision = decideSignupEligibility({
      phoneHasProfile: hasProfile,
      hasOtherOpenOrCompletedSignup: await withTx((db) => hasOtherSignupForPhone(db, phone)),
    });
    assert.deepEqual(decision, { eligible: false, reason: 'existing_profile' });
  });

  test('Telegram account already linked to an existing profile is detected', async () => {
    await q(`INSERT INTO profiles (phone_e164, full_name, pin_hash, telegram_chat_id) VALUES ($1, 'Linked', 'x', '777')`, [freshPhone()]);
    const linked = await withTx((db) => telegramAlreadyLinkedToProfile(db, 777));
    assert.equal(linked, true);
    const notLinked = await withTx((db) => telegramAlreadyLinkedToProfile(db, 778));
    assert.equal(notLinked, false);
  });

  // ─── provisioning ────────────────────────────────────────────────────────

  const stubTrial: CreateTrialFn = async ({ cafeId }) => ({
    customerId: `cus_${cafeId}`,
    subscriptionId: `sub_${cafeId}`,
    trialEnd: new Date('2026-10-01T00:00:00Z'),
  });

  test('provisionPhase1 then provisionPhase2 creates exactly one profile + cafe + membership', async () => {
    const { id: signupId, phone } = await seedSignup();
    await q(`UPDATE cafe_signups SET status = 'verified', telegram_user_id = 555 WHERE id = $1`, [signupId]);

    const eligible = await withTx((db) => findEligibleSignupForUser(db, 555));
    assert.ok(eligible);
    assert.equal(eligible!.phone_e164, phone);

    const phase1 = await withTx((db) => provisionPhase1(db, signupId, { createTrial: stubTrial }));
    assert.equal(phase1.ok, true);

    const phase2 = await withTx((db) => provisionPhase2(db, signupId, '555', { placeholderPinHash: 'placeholder-hash' }));
    assert.equal(phase2.ok, true);
    if (!phase2.ok) return;
    assert.equal(phase2.alreadyCompleted, false);

    const profiles = await q(`SELECT is_active, pin_set_at, telegram_chat_id FROM profiles WHERE phone_e164 = $1`, [phone]);
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].is_active, true);
    assert.equal(profiles[0].pin_set_at, null);
    assert.equal(profiles[0].telegram_chat_id, '555');

    const cafes = await q(`SELECT status, stripe_customer_id, stripe_subscription_id, subscription_status FROM cafes WHERE id = $1`, [phase2.cafeId]);
    assert.equal(cafes.length, 1);
    assert.equal(cafes[0].status, 'active');
    assert.equal(cafes[0].stripe_customer_id, `cus_${phase2.cafeId}`, 'billing fields must be copied from cafe_signups onto cafes');
    assert.equal(cafes[0].stripe_subscription_id, `sub_${phase2.cafeId}`);
    assert.equal(cafes[0].subscription_status, 'trialing');

    const memberships = await q(`SELECT role, status FROM cafe_memberships WHERE cafe_id = $1`, [phase2.cafeId]);
    assert.equal(memberships.length, 1);
    assert.equal(memberships[0].role, 'owner');
    assert.equal(memberships[0].status, 'active');

    const signupRow = await q(`SELECT status FROM cafe_signups WHERE id = $1`, [signupId]);
    assert.equal(signupRow[0].status, 'completed');
  });

  test('re-running provisionPhase2 on an already-completed signup is idempotent (no duplicate rows)', async () => {
    const { id: signupId } = await seedSignup();
    await q(`UPDATE cafe_signups SET status = 'verified', telegram_user_id = 556 WHERE id = $1`, [signupId]);
    await withTx((db) => provisionPhase1(db, signupId, { createTrial: stubTrial }));
    const first = await withTx((db) => provisionPhase2(db, signupId, '556', { placeholderPinHash: 'placeholder-hash' }));
    assert.equal(first.ok, true);

    const second = await withTx((db) => provisionPhase2(db, signupId, '556', { placeholderPinHash: 'placeholder-hash' }));
    assert.equal(second.ok, true);
    if (!second.ok || !first.ok) return;
    assert.equal(second.alreadyCompleted, true);
    assert.equal(second.userId, first.userId);
    assert.equal(second.cafeId, first.cafeId);

    const cafeCount = await q(`SELECT count(*)::int AS n FROM cafes WHERE id = $1`, [first.cafeId]);
    assert.equal(Number((cafeCount[0] as { n: number }).n), 1);
  });

  test('Stripe failure then retry creates exactly one café (Stripe stubbed via DI, never called for real)', async () => {
    const { id: signupId } = await seedSignup();
    await q(`UPDATE cafe_signups SET status = 'verified', telegram_user_id = 557 WHERE id = $1`, [signupId]);

    let calls = 0;
    const flakyTrial: CreateTrialFn = async (params) => {
      calls += 1;
      if (calls === 1) throw new Error('simulated Stripe outage — never a real network call');
      return stubTrial(params);
    };

    await assert.rejects(withTx((db) => provisionPhase1(db, signupId, { createTrial: flakyTrial })));
    // The whole transaction rolled back — status is still 'verified', nothing persisted.
    assert.equal((await q(`SELECT status, stripe_customer_id FROM cafe_signups WHERE id = $1`, [signupId]))[0].status, 'verified');

    const retried = await withTx((db) => provisionPhase1(db, signupId, { createTrial: flakyTrial }));
    assert.equal(retried.ok, true);
    assert.equal(calls, 2);

    const phase2 = await withTx((db) => provisionPhase2(db, signupId, '557', { placeholderPinHash: 'placeholder-hash' }));
    assert.equal(phase2.ok, true);
    if (!phase2.ok) return;

    const cafeRows = await q(`SELECT stripe_customer_id FROM cafes WHERE id = $1`, [phase2.cafeId]);
    assert.equal(cafeRows.length, 1, 'exactly one café, despite the retry');
    assert.equal(cafeRows[0].stripe_customer_id, `cus_${phase2.cafeId}`, 'the successful retry\'s Stripe id, not a stale/missing one, ends up on the café');
  });

  test('two signup rows for one phone (DB constraint prevented a second open one) still produce exactly one café', async () => {
    const phone = freshPhone();
    const a = await seedSignup({ phone });
    await assert.rejects(seedSignup({ phone }), /idx_cafe_signups_open_phone|duplicate key/i);

    await q(`UPDATE cafe_signups SET status = 'verified', telegram_user_id = 558 WHERE id = $1`, [a.id]);
    await withTx((db) => provisionPhase1(db, a.id, { createTrial: stubTrial }));
    const done = await withTx((db) => provisionPhase2(db, a.id, '558', { placeholderPinHash: 'placeholder-hash' }));
    assert.equal(done.ok, true);

    const profileCount = await q(`SELECT count(*)::int AS n FROM profiles WHERE phone_e164 = $1`, [phone]);
    assert.equal(Number((profileCount[0] as { n: number }).n), 1);
  });

  test('a manual signup slipping in between phase 1 and phase 2 is caught, not miscounted as a slug race', async () => {
    const { id: signupId, phone } = await seedSignup();
    await q(`UPDATE cafe_signups SET status = 'verified', telegram_user_id = 559 WHERE id = $1`, [signupId]);
    const phase1 = await withTx((db) => provisionPhase1(db, signupId, { createTrial: stubTrial }));
    assert.equal(phase1.ok, true);

    // Simulate the manual /api/start path creating a profile for the same phone
    // in between phase 1 and phase 2 (it doesn't take the instant flow's advisory lock).
    await q(`INSERT INTO profiles (phone_e164, full_name, pin_hash) VALUES ($1, 'Manual', 'x')`, [phone]);

    const phase2 = await withTx((db) => provisionPhase2(db, signupId, '559', { placeholderPinHash: 'placeholder-hash' }));
    assert.equal(phase2.ok, false);
    if (phase2.ok) return;
    assert.equal(phase2.reason, 'existing_profile');
  });

  // ─── PIN-set token ────────────────────────────────────────────────────────

  test('PIN-set token works once and rejects reuse', async () => {
    const owner = await q<{ id: string }>(`INSERT INTO profiles (phone_e164, full_name, pin_hash) VALUES ($1, 'Owner', 'placeholder') RETURNING id`, [freshPhone()]);
    const userId = owner[0].id;
    const token = generatePinSetToken();
    await withTx((db) => insertPinSetToken(db, userId, hashPinSetToken(token)));

    const first = await withTx((db) => consumePinSetToken(db, hashPinSetToken(token)));
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.userId, userId);

    const second = await withTx((db) => consumePinSetToken(db, hashPinSetToken(token)));
    assert.equal(second.ok, false, 'a used token must not be consumable again');
  });

  test('PIN-set token rejects expiry', async () => {
    const owner = await q<{ id: string }>(`INSERT INTO profiles (phone_e164, full_name, pin_hash) VALUES ($1, 'Owner', 'placeholder') RETURNING id`, [freshPhone()]);
    const token = generatePinSetToken();
    const tokenHash = hashPinSetToken(token);
    await withTx((db) => insertPinSetToken(db, owner[0].id, tokenHash));
    await q(`UPDATE pin_set_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE token_hash = $1`, [tokenHash]);

    const outcome = await withTx((db) => consumePinSetToken(db, tokenHash));
    assert.equal(outcome.ok, false);
  });

  test('setting the PIN bumps pin_set_at and token_version (mirrors POST /api/start/set-pin)', async () => {
    const owner = await q<{ id: string }>(
      `INSERT INTO profiles (phone_e164, full_name, pin_hash, pin_set_at, token_version) VALUES ($1, 'Owner', 'placeholder', NULL, 0) RETURNING id`,
      [freshPhone()],
    );
    const userId = owner[0].id;
    const token = generatePinSetToken();
    await withTx((db) => insertPinSetToken(db, userId, hashPinSetToken(token)));

    const consumed = await withTx((db) => consumePinSetToken(db, hashPinSetToken(token)));
    assert.equal(consumed.ok, true);
    if (!consumed.ok) return;

    await q(
      `UPDATE profiles SET pin_hash = 'real-hash', pin_set_at = NOW(), token_version = token_version + 1 WHERE id = $1`,
      [consumed.userId],
    );

    const after1 = await q<{ pin_set_at: string | null; token_version: number }>(
      `SELECT pin_set_at, token_version FROM profiles WHERE id = $1`,
      [consumed.userId],
    );
    assert.notEqual(after1[0].pin_set_at, null);
    assert.equal(Number(after1[0].token_version), 1);
  });
});
