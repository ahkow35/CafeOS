import { NextResponse } from 'next/server';
import { sql, withPlainTx, isDbUnavailable } from '@/lib/db';
import {
  AuthError,
  getSessionClaims,
  hashPin,
  PICK_COOKIE,
  requireUser,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  verifyPin,
} from '@/lib/auth';
import { attemptPin, LOCKOUT_MINUTES } from '@/lib/pinAttempts';
import { parseNewPin, parsePin, ValidationError } from '@/lib/validators';

export const runtime = 'nodejs';

interface CredentialRow {
  pin_hash: string;
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const claims = await getSessionClaims();
    if (claims?.impersonator_id) {
      return NextResponse.json({ error: 'PIN changes are unavailable in impersonation mode.' }, { status: 403 });
    }

    const user = await requireUser();
    const data = (body ?? {}) as { currentPin?: unknown; newPin?: unknown };
    const currentPin = parsePin(data.currentPin);
    const newPin = parseNewPin(data.newPin, user.phone_e164);

    const { rows } = await sql<CredentialRow>`
      SELECT pin_hash
        FROM profiles
       WHERE id = ${user.id}
       LIMIT 1
    `;
    const credential = rows[0];
    if (!credential) throw new AuthError('unauthorized', 'Not signed in');

    const attempt = await attemptPin(user.id, currentPin, credential.pin_hash);
    if (attempt.kind === 'missing') throw new AuthError('unauthorized', 'Not signed in');
    if (attempt.kind === 'locked') {
      return NextResponse.json({ error: 'Too many incorrect attempts. Try again later.' }, { status: 423 });
    }
    if (attempt.kind === 'wrong') {
      return attempt.lockedNow
        ? NextResponse.json({ error: `Too many incorrect attempts. Try again in ${LOCKOUT_MINUTES} minutes.` }, { status: 423 })
        : NextResponse.json({ error: 'Your current PIN is incorrect.' }, { status: 400 });
    }

    if (await verifyPin(newPin, credential.pin_hash)) {
      return NextResponse.json({ error: 'Choose a PIN that is different from your current PIN' }, { status: 400 });
    }

    const newPinHash = await hashPin(newPin);
    await withPlainTx(async (client) => {
      await client.query(
        `UPDATE profiles
            SET pin_hash = $1,
                failed_attempts = 0,
                locked_until = NULL,
                token_version = token_version + 1,
                updated_at = NOW()
          WHERE id = $2`,
        [newPinHash, user.id],
      );
      await client.query(
        `UPDATE pin_reset_tokens
            SET used_at = COALESCE(used_at, NOW())
          WHERE user_id = $1 AND used_at IS NULL`,
        [user.id],
      );
    });

    // A credential change revokes every session, including this one. Make that
    // explicit in the current browser instead of waiting for the next API call.
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
    res.cookies.set(PICK_COOKIE, '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
    return res;
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.code === 'unauthorized' ? 401 : 403 });
    }
    if (isDbUnavailable(e)) {
      console.error('[change-pin] database unavailable', e);
      return NextResponse.json({ error: 'CafeOS is unavailable right now. Please try again shortly.' }, { status: 503 });
    }
    console.error('[change-pin]', e);
    return NextResponse.json({ error: 'Could not update your PIN. Please try again.' }, { status: 500 });
  }
}
