/**
 * Instant café signup: form -> Telegram verification -> Stripe trial -> PIN.
 *
 * Deliberately dependency-light (only `crypto` and a same-directory import of
 * `slugifyName`) so it can be unit-tested with `node --test` and DB-tested
 * against a throwaway Postgres via `pg`, without pulling in `next/headers` or
 * `@vercel/postgres` (see tests/instantSignup.test.ts and
 * tests/db/instant-signup-sql.test.ts). Route handlers wire in the real
 * database client and the real Stripe call; nothing here imports either.
 */
import crypto from 'crypto';
import { slugifyName, ValidationError } from './validators';

export const SIGNUP_TTL_MINUTES = 30;
export const PIN_SET_TOKEN_TTL_MINUTES = 15;
export const SIGNUP_IP_LIMIT_PER_10MIN = 5;
export const SIGNUP_PHONE_LIMIT_PER_HOUR = 3;
export const BOT_ATTEMPT_LIMIT = 10;
export const BOT_ATTEMPT_WINDOW_MINUTES = 10;

// ─── Queryable: the minimal shape both @vercel/postgres's client and pg's
// Pool/PoolClient satisfy, so this module never imports either directly. ────
export interface QueryResult<R> {
  rows: R[];
  rowCount: number | null;
}
export interface Queryable {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
}

// ─── tokens ───────────────────────────────────────────────────────────────

/** 32 random bytes, base64url — 43 chars, well under Telegram's 64-char /start payload limit. */
export function generateSignupToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Deterministic so it can be looked up by equality (`WHERE token_hash = $1`). The
 *  token itself carries 256 bits of entropy, so a plain hash (no HMAC key) is fine —
 *  recovering it requires guessing the token, not attacking the hash. */
export function hashSignupToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Pin-set tokens are the same shape (32-byte base64url, sha256 hash) — reuse the
// same primitives so there's only one token scheme to reason about.
export const generatePinSetToken = generateSignupToken;
export const hashPinSetToken = hashSignupToken;

export function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

/** Avoids storing a recoverable client IP address in the database — same pattern
 *  as pinReset.ts's hashPinResetRateKey, kept as its own small helper here rather
 *  than a shared import (that file has no shared crypto util to reuse either). */
export function hashSignupIp(ip: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET must be ≥32 characters');
  return crypto.createHmac('sha256', secret).update(`signup-ip:${ip}`).digest('hex');
}

// ─── advisory locks & rate limiting ─────────────────────────────────────────

/** Serializes concurrent requests sharing `key` for the lifetime of the current
 *  transaction. Must be called inside BEGIN...COMMIT — it auto-releases at commit
 *  or rollback, never call it outside a transaction. */
export async function acquireAdvisoryLock(db: Queryable, key: string): Promise<void> {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
}

/** True when `count` is still under `limit` for rows younger than `windowMinutes`.
 *  Caller must hold the advisory lock for `key` before calling this — the lock is
 *  what makes count-then-insert safe against concurrent requests for the same key. */
async function underLimit(
  db: Queryable,
  table: string,
  column: string,
  value: string,
  windowMinutes: number,
  limit: number,
): Promise<boolean> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1 AND created_at > NOW() - ($2 || ' minutes')::interval`,
    [value, windowMinutes],
  );
  return (rows[0]?.n ?? 0) < limit;
}

export async function checkSignupIpRateLimit(db: Queryable, ipHash: string): Promise<boolean> {
  return underLimit(db, 'cafe_signups', 'request_ip_hash', ipHash, 10, SIGNUP_IP_LIMIT_PER_10MIN);
}

export async function checkSignupPhoneRateLimit(db: Queryable, phoneE164: string): Promise<boolean> {
  return underLimit(db, 'cafe_signups', 'phone_e164', phoneE164, 60, SIGNUP_PHONE_LIMIT_PER_HOUR);
}

/** Atomic count-then-insert for the bot steps, guarded by the caller's advisory
 *  lock on `signup-bot:<telegramUserId>`. Returns false (and records nothing) once
 *  the limit is hit, so a hostile user can't burn an unbounded number of rows. */
export async function checkAndRecordBotAttempt(
  db: Queryable,
  telegramUserId: number,
  limit: number = BOT_ATTEMPT_LIMIT,
  windowMinutes: number = BOT_ATTEMPT_WINDOW_MINUTES,
): Promise<boolean> {
  // Self-contained atomicity: call this inside a transaction (it takes the
  // advisory lock itself rather than trusting every caller to remember to).
  await acquireAdvisoryLock(db, `signup-bot:${telegramUserId}`);
  const ok = await underLimit(db, 'signup_bot_attempts', 'telegram_user_id', String(telegramUserId), windowMinutes, limit);
  if (!ok) return false;
  await db.query('INSERT INTO signup_bot_attempts (telegram_user_id) VALUES ($1)', [telegramUserId]);
  return true;
}

// ─── pure decisions (unit-tested without a database) ────────────────────────

export interface SignupEligibilityInput {
  phoneHasProfile: boolean;
  hasOtherOpenOrCompletedSignup: boolean;
}
export type SignupEligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: 'existing_profile' | 'signup_in_progress' };

/** Shared by POST /api/start (before insert) and provisioning (before Stripe) —
 *  same two facts decide both: does this phone already have an account, and is
 *  there another signup for it that's already open or already completed. */
export function decideSignupEligibility(input: SignupEligibilityInput): SignupEligibilityResult {
  if (input.phoneHasProfile) return { eligible: false, reason: 'existing_profile' };
  if (input.hasOtherOpenOrCompletedSignup) return { eligible: false, reason: 'signup_in_progress' };
  return { eligible: true };
}

export interface ContactAcceptanceInput {
  isPrivateChat: boolean;
  contactUserId: number | null | undefined;
  fromId: number;
  contactPhone: string;
  signupPhoneE164: string;
  /** A signup bound to this Telegram user id with status 'verified' or
   *  'provisioned' — 'provisioned' covers a retry after Stripe succeeded but the
   *  final transaction failed (spec: tapping "share" again must resume it). */
  hasEligibleSignupForUser: boolean;
  telegramAlreadyLinkedToProfile: boolean;
  phoneHasProfile: boolean;
}
export type ContactAcceptanceResult =
  | { accepted: true }
  | {
      accepted: false;
      reason:
        | 'not_private'
        | 'no_eligible_signup'
        | 'contact_user_id_mismatch'
        | 'phone_mismatch'
        | 'telegram_already_linked'
        | 'phone_now_has_profile';
    };

/** Decides whether a shared Telegram contact may complete a signup. Every check
 *  here is load-bearing: a forwarded contact has a `user_id` that differs from (or
 *  is absent vs.) `from.id`; a group chat's contact.user_id could belong to anyone
 *  in the group. */
export function decideContactAcceptance(input: ContactAcceptanceInput): ContactAcceptanceResult {
  if (!input.isPrivateChat) return { accepted: false, reason: 'not_private' };
  if (!input.hasEligibleSignupForUser) return { accepted: false, reason: 'no_eligible_signup' };
  if (input.contactUserId == null || input.contactUserId !== input.fromId) {
    return { accepted: false, reason: 'contact_user_id_mismatch' };
  }
  if (digitsOnly(input.contactPhone) !== digitsOnly(input.signupPhoneE164)) {
    return { accepted: false, reason: 'phone_mismatch' };
  }
  if (input.telegramAlreadyLinkedToProfile) return { accepted: false, reason: 'telegram_already_linked' };
  if (input.phoneHasProfile) return { accepted: false, reason: 'phone_now_has_profile' };
  return { accepted: true };
}

// ─── signup row lifecycle ────────────────────────────────────────────────────

export interface NewSignupInput {
  cafeId: string;
  cafeName: string;
  ownerName: string;
  phoneE164: string;
  email: string | null;
  tokenHash: string;
  ipHash: string;
}

/** Validates the name can produce a slug at all (cheap, catches an unslugifiable
 *  name at submit time instead of after Stripe has already been charged at
 *  provisioning time, when the same check runs again with the retry suffix loop). */
export function assertSlugifiable(cafeName: string): void {
  slugifyName(cafeName);
}

/** Deletes this phone's expired signups that never reached Stripe (pending/verified
 *  only — a 'provisioned' row holds a real Stripe customer and must never be
 *  deleted). Must run BEFORE the rate-limit counts below it in the same statement
 *  order in the caller, not after — deleting first would silently shrink the
 *  1-hour phone window by removing rows the count is supposed to see. */
export async function cleanupExpiredSignupsForPhone(db: Queryable, phoneE164: string): Promise<void> {
  await db.query(
    `DELETE FROM cafe_signups
      WHERE phone_e164 = $1 AND status IN ('pending', 'verified') AND expires_at < NOW()`,
    [phoneE164],
  );
}

export async function phoneHasProfile(db: Queryable, phoneE164: string): Promise<boolean> {
  const { rows } = await db.query('SELECT 1 FROM profiles WHERE phone_e164 = $1 LIMIT 1', [phoneE164]);
  return rows.length > 0;
}

/** Any OTHER signup (open or completed) for this phone — used both at submit time
 *  (excludeId omitted) and at provisioning time (excludeId = the current row, so a
 *  signup never conflicts with itself). */
export async function hasOtherSignupForPhone(
  db: Queryable,
  phoneE164: string,
  excludeId?: string,
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM cafe_signups
      WHERE phone_e164 = $1
        AND status IN ('pending', 'verified', 'provisioned', 'completed')
        AND id <> COALESCE($2, '00000000-0000-0000-0000-000000000000'::uuid)
      LIMIT 1`,
    [phoneE164, excludeId ?? null],
  );
  return rows.length > 0;
}

export async function insertSignup(db: Queryable, input: NewSignupInput): Promise<{ id: string }> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO cafe_signups
       (cafe_id, cafe_name, owner_name, phone_e164, email, token_hash, request_ip_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + (${SIGNUP_TTL_MINUTES} || ' minutes')::interval)
     RETURNING id`,
    [input.cafeId, input.cafeName, input.ownerName, input.phoneE164, input.email, input.tokenHash, input.ipHash],
  );
  return rows[0];
}

export interface BindTokenResult {
  ok: boolean;
  signupId?: string;
  cafeName?: string;
  ownerName?: string;
}

/** One atomic UPDATE: only a still-pending, unexpired, unbound token can bind. */
export async function bindSignupToken(
  db: Queryable,
  tokenHash: string,
  telegramUserId: number,
): Promise<BindTokenResult> {
  const { rows } = await db.query<{ id: string; cafe_name: string; owner_name: string }>(
    `UPDATE cafe_signups
        SET telegram_user_id = $2, status = 'verified', updated_at = NOW()
      WHERE token_hash = $1 AND status = 'pending' AND expires_at > NOW() AND telegram_user_id IS NULL
      RETURNING id, cafe_name, owner_name`,
    [tokenHash, telegramUserId],
  );
  if (rows.length === 0) return { ok: false };
  return { ok: true, signupId: rows[0].id, cafeName: rows[0].cafe_name, ownerName: rows[0].owner_name };
}

export interface EligibleSignupForUser {
  id: string;
  phone_e164: string;
  cafe_name: string;
  owner_name: string;
}

/** The most recent verified-or-provisioned signup bound to this Telegram user —
 *  what decideContactAcceptance's `hasEligibleSignupForUser` is built from. */
export async function findEligibleSignupForUser(
  db: Queryable,
  telegramUserId: number,
): Promise<EligibleSignupForUser | null> {
  const { rows } = await db.query<EligibleSignupForUser>(
    `SELECT id, phone_e164, cafe_name, owner_name FROM cafe_signups
      WHERE telegram_user_id = $1 AND status IN ('verified', 'provisioned')
      ORDER BY created_at DESC LIMIT 1`,
    [telegramUserId],
  );
  return rows[0] ?? null;
}

export async function telegramAlreadyLinkedToProfile(db: Queryable, telegramUserId: number): Promise<boolean> {
  const { rows } = await db.query('SELECT 1 FROM profiles WHERE telegram_chat_id = $1 LIMIT 1', [String(telegramUserId)]);
  return rows.length > 0;
}

// ─── provisioning ────────────────────────────────────────────────────────────

export interface CreateTrialResult {
  customerId: string;
  subscriptionId: string;
  trialEnd: Date;
}
export type CreateTrialFn = (params: {
  cafeId: string;
  cafeName: string;
  ownerEmail: string | null;
}) => Promise<CreateTrialResult>;

export interface ProvisionDeps {
  /** null when billing env isn't configured — provisioning proceeds without Stripe,
   *  same as /api/super/cafes/[id]/approve's billingEnabled skip. Injected (rather
   *  than imported) so tests can stub a failing-then-succeeding Stripe call without
   *  ever touching the real API. */
  createTrial: CreateTrialFn | null;
}

export type ProvisionPhase1Result =
  | { ok: true; phoneE164: string; cafeId: string; cafeName: string; ownerName: string; ownerEmail: string | null }
  | { ok: false; reason: 'not_found' | 'existing_profile' | 'signup_in_progress' };

/** Phase 1 — call inside its OWN transaction (BEGIN..COMMIT around this call).
 *  Locks the signup row and the phone, re-checks eligibility, calls Stripe only if
 *  this signup doesn't already have a customer id (idempotent retry), and persists
 *  the result with status='provisioned'. A thrown error (e.g. Stripe failing) rolls
 *  the whole transaction back, so a retry starts from the unchanged 'verified' row. */
export async function provisionPhase1(
  db: Queryable,
  signupId: string,
  deps: ProvisionDeps,
): Promise<ProvisionPhase1Result> {
  const { rows } = await db.query<{
    phone_e164: string;
    cafe_id: string;
    cafe_name: string;
    owner_name: string;
    email: string | null;
    status: string;
    stripe_customer_id: string | null;
  }>(
    `SELECT phone_e164, cafe_id, cafe_name, owner_name, email, status, stripe_customer_id
       FROM cafe_signups WHERE id = $1 FOR UPDATE`,
    [signupId],
  );
  const signup = rows[0];
  if (!signup || !['verified', 'provisioned'].includes(signup.status)) return { ok: false, reason: 'not_found' };

  await acquireAdvisoryLock(db, `signup-phone:${signup.phone_e164}`);

  const eligibility = decideSignupEligibility({
    phoneHasProfile: await phoneHasProfile(db, signup.phone_e164),
    hasOtherOpenOrCompletedSignup: await hasOtherSignupForPhone(db, signup.phone_e164, signupId),
  });
  if (!eligibility.eligible) return { ok: false, reason: eligibility.reason };

  let stripeCustomerId = signup.stripe_customer_id;
  let stripeSubscriptionId: string | null = null;
  let trialEndsAt: Date | null = null;
  if (!stripeCustomerId && deps.createTrial) {
    const trial = await deps.createTrial({
      cafeId: signup.cafe_id,
      cafeName: signup.cafe_name,
      ownerEmail: signup.email,
    });
    stripeCustomerId = trial.customerId;
    stripeSubscriptionId = trial.subscriptionId;
    trialEndsAt = trial.trialEnd;
  }

  await db.query(
    `UPDATE cafe_signups
        SET status = 'provisioned',
            stripe_customer_id     = COALESCE($2, stripe_customer_id),
            stripe_subscription_id = COALESCE($3, stripe_subscription_id),
            trial_ends_at          = COALESCE($4, trial_ends_at),
            updated_at = NOW()
      WHERE id = $1`,
    [signupId, stripeCustomerId, stripeSubscriptionId, trialEndsAt ? trialEndsAt.toISOString() : null],
  );

  return {
    ok: true,
    phoneE164: signup.phone_e164,
    cafeId: signup.cafe_id,
    cafeName: signup.cafe_name,
    ownerName: signup.owner_name,
    ownerEmail: signup.email,
  };
}

export interface ProvisionPhase2Deps {
  placeholderPinHash: string;
}

export type ProvisionPhase2Result =
  | { ok: true; userId: string; cafeId: string; cafeSlug: string; alreadyCompleted: boolean }
  | { ok: false; reason: 'not_found' | 'existing_profile' };

/** Phase 2 — call inside its OWN transaction, separate from phase 1 (spec:
 *  provisioning is Stripe-then-persist, THEN "one transaction" for the rest). Locks
 *  the signup row again and re-checks no profile exists — a manual /api/start
 *  submission for the same phone doesn't take the advisory lock, so it can slip in
 *  between phase 1 and phase 2; this catches that instead of the profile INSERT
 *  failing with a unique-violation that looks like a slug race. Idempotent: if this
 *  signup is already 'completed' (a duplicate contact message raced this one),
 *  returns the existing profile/cafe without inserting twice. */
export async function provisionPhase2(
  db: Queryable,
  signupId: string,
  chatId: string,
  deps: ProvisionPhase2Deps,
): Promise<ProvisionPhase2Result> {
  const { rows } = await db.query<{
    phone_e164: string;
    cafe_id: string;
    cafe_name: string;
    owner_name: string;
    status: string;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    trial_ends_at: string | null;
  }>(
    `SELECT phone_e164, cafe_id, cafe_name, owner_name, status,
            stripe_customer_id, stripe_subscription_id, trial_ends_at
       FROM cafe_signups WHERE id = $1 FOR UPDATE`,
    [signupId],
  );
  const signup = rows[0];
  if (!signup) return { ok: false, reason: 'not_found' };

  if (signup.status === 'completed') {
    const { rows: existing } = await db.query<{ user_id: string; slug: string }>(
      `SELECT m.user_id, c.slug FROM cafes c
         JOIN cafe_memberships m ON m.cafe_id = c.id AND m.role = 'owner'
        WHERE c.id = $1 LIMIT 1`,
      [signup.cafe_id],
    );
    if (existing[0]) return { ok: true, userId: existing[0].user_id, cafeId: signup.cafe_id, cafeSlug: existing[0].slug, alreadyCompleted: true };
    return { ok: false, reason: 'not_found' };
  }
  if (signup.status !== 'provisioned') return { ok: false, reason: 'not_found' };

  await acquireAdvisoryLock(db, `signup-phone:${signup.phone_e164}`);
  if (await phoneHasProfile(db, signup.phone_e164)) return { ok: false, reason: 'existing_profile' };

  const { rows: profRows } = await db.query<{ id: string }>(
    `INSERT INTO profiles (phone_e164, full_name, pin_hash, is_active, is_super_admin, telegram_chat_id, pin_set_at)
     VALUES ($1, $2, $3, TRUE, FALSE, $4, NULL)
     RETURNING id`,
    [signup.phone_e164, signup.owner_name, deps.placeholderPinHash, chatId],
  );
  const userId = profRows[0].id;

  let attempt = 0;
  let slug = '';
  for (;;) {
    slug = slugifyName(signup.cafe_name, attempt === 0 ? undefined : attempt + 1);
    // A SAVEPOINT is required here, not just a JS try/catch: this whole function
    // runs inside the caller's already-open transaction (unlike
    // handleManualSignup's retry loop, which opens a fresh transaction per
    // attempt). Without it, a unique-violation on `slug` poisons the entire
    // transaction — every statement after it, including the retry, fails with
    // "current transaction is aborted" instead of actually retrying.
    await db.query('SAVEPOINT cafe_insert_attempt');
    try {
      await db.query(
        `INSERT INTO cafes (
           id, slug, name, status, created_by, approved_by, approved_at,
           stripe_customer_id, stripe_subscription_id, trial_ends_at, subscription_status
         )
         VALUES ($1, $2, $3, 'active', $4, $4, NOW(), $5, $6, $7, $8)`,
        [
          signup.cafe_id,
          slug,
          signup.cafe_name,
          userId,
          signup.stripe_customer_id,
          signup.stripe_subscription_id,
          signup.trial_ends_at,
          signup.stripe_customer_id ? 'trialing' : null,
        ],
      );
      await db.query('RELEASE SAVEPOINT cafe_insert_attempt');
      break;
    } catch (e) {
      await db.query('ROLLBACK TO SAVEPOINT cafe_insert_attempt');
      if (isUniqueViolationOn(e, 'cafes_slug_key') && attempt < 9) {
        attempt += 1;
        continue;
      }
      throw e;
    }
  }

  await db.query(
    `INSERT INTO cafe_memberships (cafe_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')`,
    [signup.cafe_id, userId],
  );

  await db.query(`UPDATE cafe_signups SET status = 'completed', updated_at = NOW() WHERE id = $1`, [signupId]);

  return { ok: true, userId, cafeId: signup.cafe_id, cafeSlug: slug, alreadyCompleted: false };
}

function isUniqueViolationOn(e: unknown, constraint: string): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const err = e as { code?: string; constraint?: string };
  return err.code === '23505' && err.constraint === constraint;
}

// ─── PIN-set token lifecycle ─────────────────────────────────────────────────

export async function insertPinSetToken(db: Queryable, userId: string, tokenHash: string): Promise<void> {
  await db.query(
    `INSERT INTO pin_set_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + (${PIN_SET_TOKEN_TTL_MINUTES} || ' minutes')::interval)`,
    [userId, tokenHash],
  );
}

export type ConsumePinSetTokenResult =
  | { ok: true; userId: string }
  | { ok: false };

/** One atomic UPDATE: only an unused, unexpired token can be consumed, and it can
 *  only ever be consumed once (the WHERE re-checks used_at IS NULL). */
export async function consumePinSetToken(db: Queryable, tokenHash: string): Promise<ConsumePinSetTokenResult> {
  const { rows } = await db.query<{ user_id: string }>(
    `UPDATE pin_set_tokens
        SET used_at = NOW()
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
      RETURNING user_id`,
    [tokenHash],
  );
  if (rows.length === 0) return { ok: false };
  return { ok: true, userId: rows[0].user_id };
}

export { ValidationError };
