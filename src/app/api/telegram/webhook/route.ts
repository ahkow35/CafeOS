import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { parseE164, ValidationError } from '@/lib/validators';
import { sendTelegram } from '@/lib/notifications';

export const runtime = 'nodejs';

interface TelegramUpdate {
  message?: {
    chat?: { id: number };
    from?: { id: number; first_name?: string };
    text?: string;
  };
}

export async function POST(req: Request): Promise<Response> {
  if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const msg = update.message;
  // Use chat.id (private chat == from.id, but groups differ) and require text.
  const chatId = msg?.chat?.id ?? msg?.from?.id;
  if (!msg?.text || chatId == null) return NextResponse.json({ ok: true });
  const chatIdStr = String(chatId);
  const text = msg.text.trim();

  // /link <phone>
  const linkMatch = text.match(/^\/link\s+(.+)/i);
  if (linkMatch) {
    let phone: string;
    try {
      phone = parseE164(linkMatch[1].trim());
    } catch (e) {
      await sendTelegram(chatIdStr, e instanceof ValidationError ? e.message : 'Invalid phone number. Use: /link +6591234567');
      return NextResponse.json({ ok: true });
    }

    // Single round-trip: bind chat_id to an active profile and return the name.
    const { rows } = await sql<{ full_name: string }>`
      UPDATE profiles
         SET telegram_chat_id = ${chatIdStr}, updated_at = NOW()
       WHERE phone_e164 = ${phone}
         AND is_active = TRUE
       RETURNING full_name
    `;

    if (rows.length === 0) {
      // Tell apart "no such number" vs "inactive" with one cheap probe.
      const { rows: who } = await sql<{ is_active: boolean }>`
        SELECT is_active FROM profiles WHERE phone_e164 = ${phone} LIMIT 1
      `;
      const reason = who.length === 0
        ? `No CafeOS account found for ${phone}. Ask your manager to check your registered number.`
        : 'This account is inactive. Contact your manager.';
      await sendTelegram(chatIdStr, reason);
      return NextResponse.json({ ok: true });
    }

    await sendTelegram(chatIdStr, `✅ Linked to CafeOS as ${rows[0].full_name}.\n\nYou'll now receive notifications here.`);
    return NextResponse.json({ ok: true });
  }

  if (/^\/unlink$/i.test(text)) {
    await sql`
      UPDATE profiles SET telegram_chat_id = NULL, updated_at = NOW()
       WHERE telegram_chat_id = ${chatIdStr}
    `;
    await sendTelegram(chatIdStr, '🔕 Unlinked. You will no longer receive CafeOS notifications.');
    return NextResponse.json({ ok: true });
  }

  await sendTelegram(chatIdStr, 'CafeOS Notifications Bot\n\n/link +6591234567 — link your account\n/unlink — stop notifications');
  return NextResponse.json({ ok: true });
}
