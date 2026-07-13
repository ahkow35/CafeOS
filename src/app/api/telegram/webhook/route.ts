import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { sendTelegram } from '@/lib/notifications';

export const runtime = 'nodejs';

interface TelegramUpdate {
  message?: {
    chat?: { id: number; type?: string };
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
  const chatId = msg?.chat?.id ?? msg?.from?.id;
  if (!msg?.text || chatId == null) return NextResponse.json({ ok: true });
  const chatIdStr = String(chatId);
  const text = msg.text.trim();

  // Only private chats may be linked. A group chat would leak one member's HR
  // notifications to the whole group.
  const isPrivate = msg.chat?.type === 'private' || msg.chat?.id === msg.from?.id;

  // /link <code> — code is minted in-app by an authenticated user (see
  // /api/telegram-link). Knowing a phone number is no longer sufficient.
  const linkMatch = text.match(/^\/link(?:\s+(.*))?$/i);
  if (linkMatch) {
    if (!isPrivate) {
      await sendTelegram(chatIdStr, 'Please link from a private chat with me, not a group.');
      return NextResponse.json({ ok: true });
    }
    const code = (linkMatch[1] ?? '').trim().toUpperCase();
    if (!code) {
      await sendTelegram(chatIdStr, 'To link your account, open CafeOS → get your link code, then send:\n/link YOURCODE');
      return NextResponse.json({ ok: true });
    }

    // Atomically consume the code: only an unused, unexpired code succeeds.
    const { rows: codeRows } = await sql<{ user_id: string }>`
      UPDATE telegram_link_codes
         SET used_at = NOW()
       WHERE code = ${code}
         AND used_at IS NULL
         AND expires_at > NOW()
       RETURNING user_id
    `;
    if (codeRows.length === 0) {
      await sendTelegram(chatIdStr, '❌ That code is invalid or expired. Generate a fresh one in CafeOS.');
      return NextResponse.json({ ok: true });
    }
    const userId = codeRows[0].user_id;

    // Move the binding to this chat: clear any prior owner of this chat_id, then
    // bind the code's user (telegram_chat_id is UNIQUE).
    await sql`
      UPDATE profiles SET telegram_chat_id = NULL, updated_at = NOW()
       WHERE telegram_chat_id = ${chatIdStr} AND id <> ${userId}
    `;
    const { rows } = await sql<{ full_name: string }>`
      UPDATE profiles
         SET telegram_chat_id = ${chatIdStr}, updated_at = NOW()
       WHERE id = ${userId} AND is_active = TRUE
       RETURNING full_name
    `;
    if (rows.length === 0) {
      await sendTelegram(chatIdStr, 'This account is inactive. Contact your manager.');
      return NextResponse.json({ ok: true });
    }

    const { rows: cafeRows } = await sql<{ name: string }>`
      SELECT c.name
        FROM cafe_memberships m
        JOIN cafes c ON c.id = m.cafe_id
       WHERE m.user_id = ${userId}
         AND m.status = 'active'
         AND c.status = 'active'
       ORDER BY c.name
    `;
    const cafeList = cafeRows.length > 0
      ? cafeRows.map((c) => `• ${c.name}`).join('\n')
      : '(no active cafe memberships yet)';
    await sendTelegram(
      chatIdStr,
      `✅ Linked as ${rows[0].full_name}.\n\nYou'll receive notifications for:\n${cafeList}`,
    );
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

  await sendTelegram(chatIdStr, 'CafeOS Notifications Bot\n\nGet a link code in the CafeOS app, then send:\n/link YOURCODE — link your account\n/unlink — stop notifications');
  return NextResponse.json({ ok: true });
}
