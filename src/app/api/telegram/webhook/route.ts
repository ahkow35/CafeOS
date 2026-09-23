import { NextResponse, after } from 'next/server';
import crypto from 'crypto';
import { sql, withPlainTx, query as dbQuery } from '@/lib/db';
import { sendTelegram, notifyCafeLive, esc, type TelegramReplyMarkup } from '@/lib/notifications';
import { hashPin } from '@/lib/auth';
import { appBaseUrl } from '@/lib/appUrl';
import {
  type Queryable,
  bindSignupToken,
  checkAndRecordBotAttempt,
  decideContactAcceptance,
  findEligibleSignupForUser,
  generatePinSetToken,
  hashPinSetToken,
  hashSignupToken,
  insertPinSetToken,
  phoneHasProfile,
  provisionPhase1,
  provisionPhase2,
  telegramAlreadyLinkedToProfile,
  type ProvisionPhase1Result,
  type ProvisionPhase2Result,
} from '@/lib/instantSignup';
import { createStripeCustomerAndTrial } from '@/lib/billing';

export const runtime = 'nodejs';

interface TelegramContact {
  phone_number: string;
  user_id?: number;
}
interface TelegramUpdate {
  message?: {
    chat?: { id: number; type?: string };
    from?: { id: number; first_name?: string };
    text?: string;
    contact?: TelegramContact;
  };
}

// Read-only adapter onto the pooled @vercel/postgres client, for the
// non-transactional lookups below (findEligibleSignupForUser, etc.). Cast at
// the boundary: dbQuery's generic always resolves to Record<string, any> when
// called through a plain function value, which structurally satisfies
// Queryable's runtime shape but not its generic signature.
const pooledDb: Queryable = {
  query: (text, params) => dbQuery(text, params) as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- bridges dbQuery's collapsed generic back to Queryable's generic `query<R>`
};

const SHARE_CONTACT_KEYBOARD: TelegramReplyMarkup = {
  keyboard: [[{ text: '📱 Share my phone number', request_contact: true }]],
  one_time_keyboard: true,
  resize_keyboard: true,
};
const REMOVE_KEYBOARD: TelegramReplyMarkup = { remove_keyboard: true };

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
  if (!msg || chatId == null) return NextResponse.json({ ok: true });
  const chatIdStr = String(chatId);
  const fromId = msg.from?.id;

  // Only private chats may be linked or verified. A group chat would leak one
  // member's HR notifications to the whole group (and let anyone in the group
  // share someone else's forwarded contact).
  const isPrivate = msg.chat?.type === 'private' || msg.chat?.id === msg.from?.id;

  // A shared contact has no `text` — handle it before the text-only early
  // return below, which used to make this unreachable.
  if (msg.contact && fromId != null) {
    return handleContactShare(chatIdStr, isPrivate, fromId, msg.contact);
  }

  if (!msg.text || chatId == null) return NextResponse.json({ ok: true });
  const text = msg.text.trim();

  // /start <token> — instant café signup verification. Plain "/start" (no
  // argument) deliberately does NOT match this and falls through to the
  // existing help text below, unchanged.
  const startTokenMatch = text.match(/^\/start\s+(\S+)$/i);
  if (startTokenMatch) {
    return handleStartToken(chatIdStr, isPrivate, fromId, startTokenMatch[1]);
  }

  // /pin — a fresh set-pin link for an instant-signup owner whose link expired
  // before they used it.
  if (/^\/pin$/i.test(text)) {
    return handlePinCommand(chatIdStr, isPrivate, fromId);
  }

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

// ─── instant signup: /start <token> ─────────────────────────────────────────

async function handleStartToken(
  chatIdStr: string,
  isPrivate: boolean,
  fromId: number | undefined,
  token: string,
): Promise<Response> {
  if (!isPrivate) {
    await sendTelegram(chatIdStr, 'Please open a private chat with me to verify your café signup.');
    return NextResponse.json({ ok: true });
  }
  if (fromId == null) return NextResponse.json({ ok: true });

  const allowed = await withPlainTx((client) => checkAndRecordBotAttempt(client, fromId));
  if (!allowed) {
    await sendTelegram(chatIdStr, 'Too many attempts. Please wait a bit and try again.');
    return NextResponse.json({ ok: true });
  }

  const bound = await withPlainTx((client) => bindSignupToken(client, hashSignupToken(token), fromId));
  if (!bound.ok) {
    await sendTelegram(
      chatIdStr,
      "That verification link is invalid or has expired. Go back to the signup page and start again, or use “No Telegram? Ask us to set you up”.",
    );
    return NextResponse.json({ ok: true });
  }

  await sendTelegram(
    chatIdStr,
    `Thanks! To finish setting up <b>${esc(bound.cafeName ?? '')}</b>, tap the button below to share your phone number — this confirms it's really you.`,
    undefined,
    SHARE_CONTACT_KEYBOARD,
  );
  return NextResponse.json({ ok: true });
}

// ─── instant signup: shared contact ──────────────────────────────────────────

function contactRefusalMessage(reason: string): string {
  switch (reason) {
    case 'not_private':
      return 'Please share your contact from a private chat with me, not a group.';
    case 'no_eligible_signup':
      return "I couldn't find a verification in progress for you. Please start again from the signup page.";
    case 'contact_user_id_mismatch':
      return 'Please share YOUR OWN phone number with the button below — a forwarded contact can’t be used to verify.';
    case 'phone_mismatch':
      return "That phone number doesn't match the one on your signup. Please share the number you signed up with.";
    case 'telegram_already_linked':
      return 'This Telegram account is already linked to another CafeOS account. Please use a different Telegram account, or ask us to set you up.';
    case 'phone_now_has_profile':
      return 'This number already has a CafeOS account — sign in, or ask us to set up your café.';
    default:
      return 'Could not verify that contact. Please try again, or ask us to set you up.';
  }
}

function phase1RefusalMessage(reason: string): string {
  if (reason === 'existing_profile') {
    return 'This number already has a CafeOS account — sign in, or ask us to set up your café.';
  }
  if (reason === 'signup_in_progress') {
    return 'A signup for this number is already in progress. Check Telegram for your verification link, or wait a few minutes and try again.';
  }
  return 'Your verification has expired or is no longer valid. Please start again from the signup page.';
}

async function handleContactShare(
  chatIdStr: string,
  isPrivate: boolean,
  fromId: number,
  contact: TelegramContact,
): Promise<Response> {
  const allowed = await withPlainTx((client) => checkAndRecordBotAttempt(client, fromId));
  if (!allowed) {
    await sendTelegram(chatIdStr, 'Too many attempts. Please wait a bit and try again.', undefined, REMOVE_KEYBOARD);
    return NextResponse.json({ ok: true });
  }

  const eligibleSignup = await findEligibleSignupForUser(pooledDb, fromId);
  const decision = decideContactAcceptance({
    isPrivateChat: isPrivate,
    contactUserId: contact.user_id,
    fromId,
    contactPhone: contact.phone_number,
    signupPhoneE164: eligibleSignup?.phone_e164 ?? '',
    hasEligibleSignupForUser: eligibleSignup !== null,
    telegramAlreadyLinkedToProfile: await telegramAlreadyLinkedToProfile(pooledDb, fromId),
    phoneHasProfile: eligibleSignup ? await phoneHasProfile(pooledDb, eligibleSignup.phone_e164) : false,
  });

  if (!decision.accepted || eligibleSignup === null) {
    await sendTelegram(
      chatIdStr,
      decision.accepted ? contactRefusalMessage('no_eligible_signup') : contactRefusalMessage(decision.reason),
      undefined,
      REMOVE_KEYBOARD,
    );
    return NextResponse.json({ ok: true });
  }

  const billingEnabled = !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_PRICE_ID;
  let phase1: ProvisionPhase1Result;
  try {
    phase1 = await withPlainTx((client) =>
      provisionPhase1(client, eligibleSignup.id, {
        createTrial: billingEnabled ? createStripeCustomerAndTrial : null,
      }),
    );
  } catch (err) {
    console.error('instant signup provisionPhase1 error', err);
    await sendTelegram(
      chatIdStr,
      "Something went wrong setting up billing. Tap “Share my phone number” again to retry, or ask us to set you up.",
      undefined,
      REMOVE_KEYBOARD,
    );
    return NextResponse.json({ ok: true });
  }
  if (!phase1.ok) {
    await sendTelegram(chatIdStr, phase1RefusalMessage(phase1.reason), undefined, REMOVE_KEYBOARD);
    return NextResponse.json({ ok: true });
  }

  const placeholderPinHash = await hashPin(crypto.randomBytes(32).toString('hex'));
  let phase2: ProvisionPhase2Result;
  try {
    phase2 = await withPlainTx((client) => provisionPhase2(client, eligibleSignup.id, chatIdStr, { placeholderPinHash }));
  } catch (err) {
    console.error('instant signup provisionPhase2 error', err);
    await sendTelegram(chatIdStr, 'Something went wrong finishing setup. Please contact support.', undefined, REMOVE_KEYBOARD);
    return NextResponse.json({ ok: true });
  }
  if (!phase2.ok) {
    await sendTelegram(
      chatIdStr,
      'This number now has an account already — sign in, or ask us to set you up.',
      undefined,
      REMOVE_KEYBOARD,
    );
    return NextResponse.json({ ok: true });
  }

  const pinToken = generatePinSetToken();
  await withPlainTx((client) => insertPinSetToken(client, phase2.userId, hashPinSetToken(pinToken)));

  await sendTelegram(
    chatIdStr,
    `🎉 <b>${esc(eligibleSignup.cafe_name)}</b> is ready! Tap below to set your 6-digit PIN and finish setup.\n\n${appBaseUrl()}/start/set-pin?token=${pinToken}`,
    undefined,
    REMOVE_KEYBOARD,
  );

  if (!phase2.alreadyCompleted) {
    after(async () => {
      try {
        await notifyCafeLive({
          cafeName: eligibleSignup.cafe_name,
          ownerName: eligibleSignup.owner_name,
          ownerPhone: eligibleSignup.phone_e164,
        });
      } catch (err) {
        console.error('notifyCafeLive error:', err);
      }
    });
  }

  return NextResponse.json({ ok: true });
}

// ─── instant signup: /pin (fresh set-pin link after the first one expired) ──

async function handlePinCommand(
  chatIdStr: string,
  isPrivate: boolean,
  fromId: number | undefined,
): Promise<Response> {
  if (!isPrivate || fromId == null) return NextResponse.json({ ok: true });

  const allowed = await withPlainTx((client) => checkAndRecordBotAttempt(client, fromId));
  if (!allowed) {
    await sendTelegram(chatIdStr, 'Too many attempts. Please wait a bit and try again.');
    return NextResponse.json({ ok: true });
  }

  // Only a Telegram account linked (by the instant-signup flow) to an owner who
  // has never set a real PIN yet qualifies — anyone who already has a working
  // PIN uses the normal /login/reset flow instead.
  const { rows } = await dbQuery<{ id: string }>(
    `SELECT id FROM profiles WHERE telegram_chat_id = $1 AND pin_set_at IS NULL AND is_active = TRUE LIMIT 1`,
    [chatIdStr],
  );
  if (rows.length === 0) {
    await sendTelegram(
      chatIdStr,
      "I can't issue a PIN-set link for this account. If you already have a PIN, use the “Forgot PIN” link on the CafeOS login page instead.",
    );
    return NextResponse.json({ ok: true });
  }

  const pinToken = generatePinSetToken();
  await withPlainTx((client) => insertPinSetToken(client, rows[0].id, hashPinSetToken(pinToken)));
  await sendTelegram(chatIdStr, `Tap below to set your 6-digit PIN:\n\n${appBaseUrl()}/start/set-pin?token=${pinToken}`);
  return NextResponse.json({ ok: true });
}
