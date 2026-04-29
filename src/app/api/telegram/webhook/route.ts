import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { parseE164, ValidationError } from '@/lib/validators';

export const runtime = 'nodejs';

interface TelegramUpdate {
  message?: {
    from: { id: number; first_name?: string };
    text?: string;
  };
}

async function reply(chatId: number, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

export async function POST(req: Request): Promise<Response> {
  // Verify webhook secret
  const secret = req.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const msg = update.message;
  if (!msg?.text || !msg.from) return NextResponse.json({ ok: true });

  const chatId = msg.from.id;
  const text = msg.text.trim();

  // /link <phone>
  const linkMatch = text.match(/^\/link\s+(.+)/i);
  if (linkMatch) {
    let phone: string;
    try {
      phone = parseE164(linkMatch[1].trim());
    } catch (e) {
      await reply(chatId, e instanceof ValidationError ? e.message : 'Invalid phone number. Use: /link +6591234567');
      return NextResponse.json({ ok: true });
    }

    const { rows } = await sql<{ full_name: string; is_active: boolean }>`
      SELECT full_name, is_active FROM profiles WHERE phone_e164 = ${phone} LIMIT 1
    `;

    if (rows.length === 0) {
      await reply(chatId, `No CafeOS account found for ${phone}. Ask your manager to check your registered number.`);
      return NextResponse.json({ ok: true });
    }

    if (!rows[0].is_active) {
      await reply(chatId, 'This account is inactive. Contact your manager.');
      return NextResponse.json({ ok: true });
    }

    await sql`
      UPDATE profiles SET telegram_chat_id = ${String(chatId)}, updated_at = NOW()
       WHERE phone_e164 = ${phone}
    `;

    await reply(chatId, `✅ Linked to CafeOS as ${rows[0].full_name}.\n\nYou'll now receive leave notifications here.`);
    return NextResponse.json({ ok: true });
  }

  // /unlink
  if (/^\/unlink$/i.test(text)) {
    await sql`
      UPDATE profiles SET telegram_chat_id = NULL, updated_at = NOW()
       WHERE telegram_chat_id = ${String(chatId)}
    `;
    await reply(chatId, '🔕 Unlinked. You will no longer receive CafeOS notifications.');
    return NextResponse.json({ ok: true });
  }

  // Default help
  await reply(chatId, 'CafeOS Notifications Bot\n\n/link +6591234567 — link your account\n/unlink — stop notifications');
  return NextResponse.json({ ok: true });
}
