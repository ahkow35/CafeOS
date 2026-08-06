import { after, NextResponse } from 'next/server';
import { sql, isDbUnavailable } from '@/lib/db';
import { sendTelegram } from '@/lib/notifications';
import { parseE164, ValidationError } from '@/lib/validators';
import {
  generatePinResetCode,
  getRequestIp,
  hashPinResetCode,
  hashPinResetRateKey,
  PIN_RESET_ACCOUNT_LIMIT_PER_HOUR,
  PIN_RESET_CODE_TTL_MINUTES,
  PIN_RESET_IP_LIMIT_PER_HOUR,
} from '@/lib/pinReset';

export const runtime = 'nodejs';

const GENERIC_MESSAGE =
  'If that account is active and linked to Telegram, a verification code is on its way.';

interface ProfileRecoveryRow {
  id: string;
  telegram_chat_id: string | null;
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const phone = parseE164((body as { phone?: unknown } | null)?.phone);
    const code = generatePinResetCode();
    const codeHash = hashPinResetCode(phone, code);
    const ipHash = hashPinResetRateKey(getRequestIp(req));

    const { rows } = await sql<ProfileRecoveryRow>`
      SELECT id, telegram_chat_id
        FROM profiles
       WHERE phone_e164 = ${phone}
         AND is_active = TRUE
       LIMIT 1
    `;
    const profile = rows[0];

    // Never disclose whether a phone number exists or has Telegram linked.
    if (!profile?.telegram_chat_id) {
      return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
    }

    const [{ rows: accountRateRows }, { rows: ipRateRows }] = await Promise.all([
      sql<{ recent: number; last_requested_at: string | null }>`
        SELECT COUNT(*)::int AS recent,
               MAX(created_at)::text AS last_requested_at
          FROM pin_reset_tokens
         WHERE user_id = ${profile.id}
           AND created_at > NOW() - INTERVAL '1 hour'
      `,
      sql<{ recent: number }>`
        SELECT COUNT(*)::int AS recent
          FROM pin_reset_tokens
         WHERE request_ip_hash = ${ipHash}
           AND created_at > NOW() - INTERVAL '1 hour'
      `,
    ]);

    const accountRate = accountRateRows[0];
    const lastRequestedAt = accountRate?.last_requested_at
      ? new Date(accountRate.last_requested_at).getTime()
      : 0;
    const stillCoolingDown = Date.now() - lastRequestedAt < 60_000;
    const rateLimited =
      stillCoolingDown ||
      (accountRate?.recent ?? 0) >= PIN_RESET_ACCOUNT_LIMIT_PER_HOUR ||
      (ipRateRows[0]?.recent ?? 0) >= PIN_RESET_IP_LIMIT_PER_HOUR;

    // A rate-limited request gets the same response as a successful one.
    if (rateLimited) {
      return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
    }

    // Invalidate older codes but keep their rows for the one-hour rate window.
    await sql`
      UPDATE pin_reset_tokens
         SET used_at = COALESCE(used_at, NOW())
       WHERE user_id = ${profile.id}
         AND used_at IS NULL
    `;
    await sql`
      INSERT INTO pin_reset_tokens
        (user_id, code_hash, request_ip_hash, expires_at)
      VALUES
        (${profile.id}, ${codeHash}, ${ipHash}, NOW() + (${PIN_RESET_CODE_TTL_MINUTES} || ' minutes')::interval)
    `;

    // Deliver after the response so valid accounts do not have an obvious
    // Telegram-network timing signature that helps enumerate phone numbers.
    after(() => sendTelegram(
      profile.telegram_chat_id as string,
      `🔐 <b>CafeOS PIN reset</b>\n\nYour verification code is: <code>${code}</code>\n\nIt expires in ${PIN_RESET_CODE_TTL_MINUTES} minutes and can be used once. If you did not request this, you can ignore this message.`,
    ));

    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (isDbUnavailable(e)) {
      console.error('[pin-reset/request] database unavailable', e);
      return NextResponse.json({ error: 'CafeOS is unavailable right now. Please try again shortly.' }, { status: 503 });
    }
    console.error('[pin-reset/request]', e);
    return NextResponse.json({ error: 'Could not start PIN recovery. Please try again.' }, { status: 500 });
  }
}
