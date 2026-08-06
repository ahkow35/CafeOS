import { NextResponse } from 'next/server';
import { withPlainTx, isDbUnavailable } from '@/lib/db';
import {
  hashPin,
  verifyPin,
  SESSION_COOKIE,
  PICK_COOKIE,
  SESSION_COOKIE_OPTIONS,
} from '@/lib/auth';
import { hashPinResetCode, resetCodeMatches } from '@/lib/pinReset';
import { parseE164, parseNewPin, parseResetCode, ValidationError } from '@/lib/validators';

export const runtime = 'nodejs';

class InvalidResetCodeError extends Error {}

interface ResetRow {
  id: string;
  user_id: string;
  code_hash: string;
  attempts_remaining: number;
  expires_at: string;
  used_at: string | null;
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
    const data = (body ?? {}) as { phone?: unknown; code?: unknown; newPin?: unknown };
    const phone = parseE164(data.phone);
    const code = parseResetCode(data.code);
    const newPin = parseNewPin(data.newPin, phone);
    const submittedHash = hashPinResetCode(phone, code);

    const outcome = await withPlainTx(async (client): Promise<'ok' | 'invalid'> => {
      const result = await client.query(
        `SELECT t.id, t.user_id, t.code_hash, t.attempts_remaining,
                t.expires_at::text, t.used_at::text, p.pin_hash
           FROM pin_reset_tokens t
           JOIN profiles p ON p.id = t.user_id
          WHERE p.phone_e164 = $1
            AND p.is_active = TRUE
          ORDER BY t.created_at DESC
          LIMIT 1
          FOR UPDATE`,
        [phone],
      );
      const row = result.rows[0] as ResetRow | undefined;
      const unusable =
        !row ||
        row.used_at !== null ||
        row.attempts_remaining <= 0 ||
        new Date(row.expires_at).getTime() <= Date.now();

      if (unusable) return 'invalid';

      if (!resetCodeMatches(row.code_hash, submittedHash)) {
        await client.query(
          `UPDATE pin_reset_tokens
              SET attempts_remaining = GREATEST(attempts_remaining - 1, 0),
                  used_at = CASE WHEN attempts_remaining <= 1 THEN NOW() ELSE used_at END
            WHERE id = $1`,
          [row.id],
        );
        return 'invalid';
      }

      if (await verifyPin(newPin, row.pin_hash)) {
        throw new ValidationError('Choose a PIN that is different from your current PIN');
      }

      const newPinHash = await hashPin(newPin);
      await client.query(
        `UPDATE profiles
            SET pin_hash = $1,
                failed_attempts = 0,
                locked_until = NULL,
                token_version = token_version + 1,
                updated_at = NOW()
          WHERE id = $2`,
        [newPinHash, row.user_id],
      );
      await client.query(
        `UPDATE pin_reset_tokens
            SET used_at = COALESCE(used_at, NOW())
          WHERE user_id = $1 AND used_at IS NULL`,
        [row.user_id],
      );
      return 'ok';
    });

    if (outcome === 'invalid') throw new InvalidResetCodeError();

    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
    res.cookies.set(PICK_COOKIE, '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
    return res;
  } catch (e) {
    if (e instanceof InvalidResetCodeError) {
      return NextResponse.json({ error: 'That code is incorrect or has expired. Request a new code and try again.' }, { status: 400 });
    }
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (isDbUnavailable(e)) {
      console.error('[pin-reset/confirm] database unavailable', e);
      return NextResponse.json({ error: 'CafeOS is unavailable right now. Please try again shortly.' }, { status: 503 });
    }
    console.error('[pin-reset/confirm]', e);
    return NextResponse.json({ error: 'Could not reset your PIN. Please try again.' }, { status: 500 });
  }
}
