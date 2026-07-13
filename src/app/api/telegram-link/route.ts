import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/auth';
import crypto from 'crypto';

export const runtime = 'nodejs';

// Deliberately NOT under /api/telegram/ (which is public for the bot webhook):
// this path is session-gated by middleware AND re-checks auth here, so only a
// signed-in user can mint a code to link THEIR OWN account.

const CODE_TTL_MINUTES = 10;

function generateCode(): string {
  // 8 uppercase hex chars — enough entropy for a single-use, 10-minute code,
  // short enough to retype into Telegram.
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

export async function POST(): Promise<Response> {
  try {
    const user = await requireUser();

    // Invalidate any prior unused codes for this user, then issue a fresh one.
    await sql`DELETE FROM telegram_link_codes WHERE user_id = ${user.id} AND used_at IS NULL`;

    const code = generateCode();
    await sql`
      INSERT INTO telegram_link_codes (code, user_id, expires_at)
      VALUES (${code}, ${user.id}, NOW() + (${CODE_TTL_MINUTES} || ' minutes')::interval)
    `;

    return NextResponse.json({ code, expiresInMinutes: CODE_TTL_MINUTES });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.code === 'unauthorized' ? 401 : 403 });
    }
    console.error('telegram-link mint error', e);
    return NextResponse.json({ error: 'Failed to create link code' }, { status: 500 });
  }
}
