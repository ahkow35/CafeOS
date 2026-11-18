import { NextResponse, after } from 'next/server';
import { headers } from 'next/headers';
import crypto from 'crypto';
import { sql, withPlainTx } from '@/lib/db';
import { parseE164, parseFullName, parseCafeName, parseEmail, slugifyName, ValidationError } from '@/lib/validators';
import { hashPin } from '@/lib/auth';
import { notifyCafeSignup } from '@/lib/notifications';
import { telegramBotUsername } from '@/lib/appUrl';
import {
  assertSlugifiable,
  checkSignupIpRateLimit,
  checkSignupPhoneRateLimit,
  cleanupExpiredSignupsForPhone,
  decideSignupEligibility,
  generateSignupToken,
  hashSignupIp,
  hashSignupToken,
  hasOtherSignupForPhone,
  insertSignup,
  phoneHasProfile,
  acquireAdvisoryLock,
} from '@/lib/instantSignup';
import { getRequestIp } from '@/lib/pinReset';

export const runtime = 'nodejs';

/** The applicant already owns a pending/active cafe — reject without mutating anything. */
class DuplicateApplicationError extends Error {}
class ExistingProfileError extends Error {}
class SignupInProgressError extends Error {}
class InstantRateLimitError extends Error {}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}

// Per-instance rate limiter for the MANUAL path only — the instant path uses the
// DB-backed atomic limits in @/lib/instantSignup instead (see checkSignupIpRateLimit
// / checkSignupPhoneRateLimit); relying on this in-memory counter for the instant
// path would not survive multiple server instances or a redeploy.
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const ipCounts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): void {
  const now = Date.now();
  const entry = ipCounts.get(ip);
  if (!entry || entry.resetAt < now) {
    ipCounts.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return;
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT) {
    throw new ValidationError('Too many signup attempts. Please try again later.');
  }
}

interface StartFields {
  cafeName: string;
  ownerName: string;
  ownerPhone: string;
  ownerEmail: string | null;
}

function parseFields(body: Record<string, unknown>): StartFields {
  return {
    cafeName: parseCafeName(body.cafeName),
    ownerName: parseFullName(body.ownerName),
    ownerPhone: parseE164(body.ownerPhone),
    ownerEmail: body.ownerEmail != null ? parseEmail(String(body.ownerEmail)) : null,
  };
}

/**
 * The original /api/start behaviour, unchanged: creates a pending cafe + owner
 * profile (find-or-create by phone) awaiting super-admin review, exactly as
 * POST /api/super/cafes/[id]/approve expects (including PR #13's owner-credential
 * rules). This is now the fallback for "No Telegram? Ask us to set you up" on the
 * /start page — the instant path below is the default.
 */
async function handleManualSignup(ip: string, fields: StartFields): Promise<Response> {
  const { cafeName, ownerName, ownerPhone, ownerEmail } = fields;
  try {
    checkRateLimit(ip);

    // Placeholder hash — cannot match any real 6-digit PIN. A new profile stays
    // is_active=false until super admin approves and issues a real PIN. Computed
    // once; unused for existing profiles (their pin_hash is preserved).
    const placeholderHash = await hashPin(crypto.randomBytes(32).toString('hex'));

    // Everything below is atomic and idempotent, and the "already applied" check
    // runs INSIDE the transaction BEFORE any cafe is created. Retry on a slug
    // unique-violation (another signup raced for the same slug).
    let attempt = 0;
    for (;;) {
      const slug = slugifyName(cafeName, attempt === 0 ? undefined : attempt + 1);
      try {
        await withPlainTx(async (tx) => {
          // Find-or-create the owner profile atomically. On an existing phone we
          // NEVER overwrite the stored email — COALESCE keeps the current value —
          // so this endpoint can't be used to tamper with someone's account.
          const { rows: prof } = await tx.query<{ id: string }>(
            `INSERT INTO profiles (phone_e164, full_name, pin_hash, is_active, is_super_admin, email)
             VALUES ($1, $2, $3, FALSE, FALSE, $4)
             ON CONFLICT (phone_e164)
               DO UPDATE SET email = COALESCE(profiles.email, EXCLUDED.email)
             RETURNING id`,
            [ownerPhone, ownerName, placeholderHash, ownerEmail],
          );
          const profileId = prof[0].id;

          // Reject a duplicate application BEFORE creating anything.
          const { rows: existing } = await tx.query<{ status: string }>(
            `SELECT c.status FROM cafes c
               JOIN cafe_memberships m ON m.cafe_id = c.id
              WHERE m.user_id = $1 AND m.role = 'owner'
              ORDER BY c.created_at DESC LIMIT 1`,
            [profileId],
          );
          if (existing.length > 0 && (existing[0].status === 'pending' || existing[0].status === 'active')) {
            throw new DuplicateApplicationError(existing[0].status);
          }

          const { rows: cafeRows } = await tx.query<{ id: string }>(
            `INSERT INTO cafes (slug, name, status, created_by)
             VALUES ($1, $2, 'pending', $3) RETURNING id`,
            [slug, cafeName, profileId],
          );
          await tx.query(
            `INSERT INTO cafe_memberships (cafe_id, user_id, role, status)
             VALUES ($1, $2, 'owner', 'pending')`,
            [cafeRows[0].id, profileId],
          );
        });
        break; // success
      } catch (e) {
        if (e instanceof DuplicateApplicationError) {
          return NextResponse.json(
            {
              error: e.message === 'active'
                ? 'This phone number already has an active cafe. Log in at /login.'
                : 'A signup request for this phone number is already pending review.',
            },
            { status: 409 },
          );
        }
        // Slug raced — try the next suffix. Give up after a handful of attempts.
        if (isUniqueViolation(e) && attempt < 9) {
          attempt += 1;
          continue;
        }
        if (isUniqueViolation(e)) {
          return NextResponse.json(
            { error: 'Could not generate a unique slug for this name. Try a slightly different name.' },
            { status: 409 },
          );
        }
        throw e;
      }
    }

    // Notify super admins out-of-band.
    after(async () => {
      try {
        await notifyCafeSignup({ cafeName, ownerName, ownerPhone });
      } catch (err) {
        console.error('notifyCafeSignup error:', err);
      }
    });

    return NextResponse.json(
      { ok: true, message: 'Application submitted. We will contact you once it is reviewed.' },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error('start POST (manual) error', e);
    return NextResponse.json({ error: 'Failed to submit application' }, { status: 500 });
  }
}

/**
 * The instant path: creates a cafe_signups row and returns a Telegram deep link.
 * Never touches the profiles table, never mutates an existing account — see
 * db/migrations/2026-09-24-instant-signup.sql. Provisioning (Stripe + the actual
 * profile/cafe/membership rows) happens later, from the Telegram webhook once the
 * owner verifies their phone by sharing their contact — see
 * src/app/api/telegram/webhook/route.ts.
 */
async function handleInstantSignup(ip: string, fields: StartFields): Promise<Response> {
  const { cafeName, ownerName, ownerPhone, ownerEmail } = fields;
  try {
    assertSlugifiable(cafeName);

    const ipHash = hashSignupIp(ip);
    const token = generateSignupToken();
    const tokenHash = hashSignupToken(token);
    const cafeId = crypto.randomUUID();

    const signupId = await withPlainTx(async (client) => {
      // Serialize concurrent requests sharing this IP or this phone before doing
      // any count — this is what makes the rate-limit checks below atomic instead
      // of a count-then-insert race.
      await acquireAdvisoryLock(client, `signup-ip:${ipHash}`);
      await acquireAdvisoryLock(client, `signup-phone:${ownerPhone}`);

      if (!(await checkSignupIpRateLimit(client, ipHash))) throw new InstantRateLimitError();
      if (!(await checkSignupPhoneRateLimit(client, ownerPhone))) throw new InstantRateLimitError();

      // Clean up this phone's expired attempts BEFORE checking eligibility — a
      // stale 'pending'/'verified' row would otherwise block a legitimate retry
      // via the open-signup partial unique index. Never touches 'provisioned' rows
      // (those hold a real Stripe customer).
      await cleanupExpiredSignupsForPhone(client, ownerPhone);

      const eligibility = decideSignupEligibility({
        phoneHasProfile: await phoneHasProfile(client, ownerPhone),
        hasOtherOpenOrCompletedSignup: await hasOtherSignupForPhone(client, ownerPhone),
      });
      if (!eligibility.eligible) {
        throw eligibility.reason === 'existing_profile' ? new ExistingProfileError() : new SignupInProgressError();
      }

      const { id } = await insertSignup(client, {
        cafeId,
        cafeName,
        ownerName,
        phoneE164: ownerPhone,
        email: ownerEmail,
        tokenHash,
        ipHash,
      });
      return id;
    });

    return NextResponse.json(
      {
        ok: true,
        signupId,
        deepLink: `https://t.me/${telegramBotUsername()}?start=${token}`,
      },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof ExistingProfileError) {
      return NextResponse.json(
        { error: 'This number already has a CafeOS account — sign in, or ask us to set up your café.' },
        { status: 409 },
      );
    }
    if (e instanceof SignupInProgressError) {
      return NextResponse.json(
        { error: 'A signup for this number is already in progress. Check Telegram for your verification link, or wait a few minutes and try again.' },
        { status: 409 },
      );
    }
    if (e instanceof InstantRateLimitError) {
      return NextResponse.json({ error: 'Too many signup attempts. Please try again later.' }, { status: 429 });
    }
    console.error('start POST (instant) error', e);
    return NextResponse.json({ error: 'Failed to start signup' }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<Response> {
  const hdrs = await headers();
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  let fields: StartFields;
  try {
    fields = parseFields(body);
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }

  return body.mode === 'manual'
    ? handleManualSignup(ip, fields)
    : handleInstantSignup(getRequestIp(req) || ip, fields);
}
