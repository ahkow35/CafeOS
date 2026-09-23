import { NextResponse } from 'next/server';
import { sql, withPlainTx } from '@/lib/db';
import { hashPin, login, SESSION_COOKIE, SESSION_COOKIE_OPTIONS, SESSION_COOKIE_MAX_AGE, AuthError } from '@/lib/auth';
import { parsePin, ValidationError } from '@/lib/validators';
import { consumePinSetToken, hashPinSetToken } from '@/lib/instantSignup';

export const runtime = 'nodejs';

/**
 * Sets the FIRST real PIN for an instant-signup owner (their profile still
 * carries the /api/start-style placeholder hash and pin_set_at IS NULL until
 * this runs). Consumes the one-time link the Telegram bot sent after
 * provisioning, then signs the owner in directly — same as POST
 * /api/auth/login — so they land in their café without retyping anything.
 */
export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const data = (body ?? {}) as { token?: unknown; pin?: unknown; confirmPin?: unknown };
    if (typeof data.token !== 'string' || data.token.length === 0) {
      throw new ValidationError('Missing or invalid token');
    }
    const pin = parsePin(data.pin);
    const confirmPin = parsePin(data.confirmPin);
    if (pin !== confirmPin) throw new ValidationError('The two PINs do not match');

    const tokenHash = hashPinSetToken(data.token);
    const pinHash = await hashPin(pin);

    const userId = await withPlainTx(async (client) => {
      const consumed = await consumePinSetToken(client, tokenHash);
      if (!consumed.ok) return null;
      await client.query(
        `UPDATE profiles
            SET pin_hash = $1, pin_set_at = NOW(), token_version = token_version + 1, updated_at = NOW()
          WHERE id = $2`,
        [pinHash, consumed.userId],
      );
      return consumed.userId;
    });

    if (!userId) {
      return NextResponse.json(
        { error: 'This link is invalid, expired, or has already been used. Send /pin to the bot for a fresh one.' },
        { status: 400 },
      );
    }

    const { rows } = await sql<{ phone_e164: string }>`
      SELECT phone_e164 FROM profiles WHERE id = ${userId} LIMIT 1
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Could not find your account.' }, { status: 500 });
    }

    const result = await login(rows[0].phone_e164, pin);
    if (result.kind === 'session') {
      const res = NextResponse.json({
        ok: true,
        redirect: result.user.active_cafe ? `/c/${result.user.active_cafe.slug}/` : '/super',
      });
      res.cookies.set(SESSION_COOKIE, result.token, { ...SESSION_COOKIE_OPTIONS, maxAge: SESSION_COOKIE_MAX_AGE });
      return res;
    }
    // A brand-new owner has exactly one membership, so `login` should always
    // return 'session' above — this is a defensive fallback, not the happy path.
    return NextResponse.json({ ok: true, redirect: '/login' });
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: true, redirect: '/login' });
    }
    console.error('start/set-pin POST error', e);
    return NextResponse.json({ error: 'Could not set your PIN. Please try again.' }, { status: 500 });
  }
}
