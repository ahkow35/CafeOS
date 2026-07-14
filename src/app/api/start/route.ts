import { NextResponse, after } from 'next/server';
import { headers } from 'next/headers';
import crypto from 'crypto';
import { sql, withPlainTx } from '@/lib/db';
import { parseE164, parseFullName, parseCafeName, parseEmail, slugifyName, ValidationError } from '@/lib/validators';
import { hashPin } from '@/lib/auth';
import { notifyCafeSignup } from '@/lib/notifications';

export const runtime = 'nodejs';

/** The applicant already owns a pending/active cafe — reject without mutating anything. */
class DuplicateApplicationError extends Error {}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}

// Per-instance rate limiter: max 5 submissions per 10 minutes from the same IP.
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

export async function POST(req: Request): Promise<Response> {
  const hdrs = await headers();
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

  try {
    checkRateLimit(ip);

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const cafeName = parseCafeName(body.cafeName);
    const ownerName = parseFullName(body.ownerName);
    const ownerPhone = parseE164(body.ownerPhone);
    const ownerEmail = body.ownerEmail != null
      ? parseEmail(String(body.ownerEmail))
      : null;

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
    const capturedCafeName = cafeName;
    const capturedOwnerName = ownerName;
    const capturedOwnerPhone = ownerPhone;
    after(async () => {
      try {
        await notifyCafeSignup({
          cafeName: capturedCafeName,
          ownerName: capturedOwnerName,
          ownerPhone: capturedOwnerPhone,
        });
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
    console.error('start POST error', e);
    return NextResponse.json({ error: 'Failed to submit application' }, { status: 500 });
  }
}
