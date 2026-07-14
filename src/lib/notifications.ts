import { sql } from '@/lib/db';
import { formatMonthYear } from '@/lib/dateUtils';
import { appBaseUrl as baseUrl } from '@/lib/appUrl';

const SHORT_DATE = (d: string) => {
  const dt = new Date(d.split('T')[0] + 'T00:00:00');
  return dt.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
};

/**
 * Escape a dynamic value before it goes into a parse_mode:'HTML' message. Without
 * this, a name/reason containing &, < or > produces malformed HTML — Telegram
 * rejects the whole message (so the notification silently never arrives) and a
 * crafted value could inject markup.
 */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function sendTelegram(chatId: string, text: string, botToken?: string): Promise<void> {
  const token = botToken ?? process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    if (!res.ok) {
      console.error('Telegram sendMessage failed:', await res.text());
    }
  } catch (e) {
    console.error('Telegram notification error:', e);
  }
}

/** Look up the cafe slug from its ID. Returns null if not found. */
async function getCafeSlug(cafeId: string): Promise<string | null> {
  const { rows } = await sql<{ slug: string }>`SELECT slug FROM cafes WHERE id = ${cafeId} LIMIT 1`;
  return rows[0]?.slug ?? null;
}

/** All active managers + owners in the given cafe who have a Telegram chat linked. */
async function getManagerRecipients(cafeId: string): Promise<string[]> {
  const { rows } = await sql<{ telegram_chat_id: string }>`
    SELECT p.telegram_chat_id
      FROM profiles p
      JOIN cafe_memberships m ON m.user_id = p.id AND m.cafe_id = ${cafeId}
     WHERE m.role IN ('manager', 'owner')
       AND m.status = 'active'
       AND p.is_active = TRUE
       AND p.telegram_chat_id IS NOT NULL
  `;
  return rows.map((r) => r.telegram_chat_id);
}

/** Active owners only in the given cafe who have a Telegram chat linked. */
async function getOwnerRecipients(cafeId: string): Promise<string[]> {
  const { rows } = await sql<{ telegram_chat_id: string }>`
    SELECT p.telegram_chat_id
      FROM profiles p
      JOIN cafe_memberships m ON m.user_id = p.id AND m.cafe_id = ${cafeId}
     WHERE m.role = 'owner'
       AND m.status = 'active'
       AND p.is_active = TRUE
       AND p.telegram_chat_id IS NOT NULL
  `;
  return rows.map((r) => r.telegram_chat_id);
}

// ---------------------------------------------------------------------------
// Leave notifications
// ---------------------------------------------------------------------------

interface NotifyLeaveSubmittedArgs {
  cafeId: string;
  requesterName: string;
  leaveType: 'annual' | 'medical';
  startDate: string;
  endDate: string;
  days: number;
}

/** Notify all managers + owners of this cafe that a leave request needs review. */
export async function notifyLeaveSubmitted(args: NotifyLeaveSubmittedArgs): Promise<void> {
  const [recipients, slug] = await Promise.all([
    getManagerRecipients(args.cafeId),
    getCafeSlug(args.cafeId),
  ]);
  if (recipients.length === 0) {
    // Not an error, but the most common cause of "manager got no alert": no active
    // manager/owner in this cafe has linked Telegram. Logged so it's not silent.
    console.warn(`notifyLeaveSubmitted: no linked manager/owner recipients in cafe ${args.cafeId}`);
    return;
  }

  const dateRange = args.startDate === args.endDate
    ? SHORT_DATE(args.startDate)
    : `${SHORT_DATE(args.startDate)} – ${SHORT_DATE(args.endDate)}`;

  const reviewUrl = slug ? `${baseUrl()}/c/${slug}/admin/leave` : baseUrl();
  const text = `📋 <b>New Leave Request</b>\n\n${esc(args.requesterName)} submitted a ${args.days}-day ${args.leaveType} leave (${dateRange}).\n\nReview: ${reviewUrl}`;

  await Promise.all(recipients.map((chatId) => sendTelegram(chatId, text)));
}

interface NotifyLeaveDecisionArgs {
  cafeId: string;
  requesterUserId: string;
  leaveType: 'annual' | 'medical';
  startDate: string;
  endDate: string;
  days: number;
  approved: boolean;
}

/** Notify the leave requester of a final approval or rejection. */
export async function notifyLeaveDecision(args: NotifyLeaveDecisionArgs): Promise<void> {
  const { rows } = await sql<{ telegram_chat_id: string }>`
    SELECT telegram_chat_id FROM profiles
     WHERE id = ${args.requesterUserId}
       AND telegram_chat_id IS NOT NULL
     LIMIT 1
  `;
  if (rows.length === 0) return;

  const dateRange = args.startDate === args.endDate
    ? SHORT_DATE(args.startDate)
    : `${SHORT_DATE(args.startDate)} – ${SHORT_DATE(args.endDate)}`;

  const icon = args.approved ? '✅' : '❌';
  const verb = args.approved ? 'approved' : 'rejected';
  const text = `${icon} <b>Leave ${verb.charAt(0).toUpperCase() + verb.slice(1)}</b>\n\nYour ${args.days}-day ${args.leaveType} leave (${dateRange}) has been <b>${verb}</b>.`;

  await sendTelegram(rows[0].telegram_chat_id, text);
}

// ---------------------------------------------------------------------------
// Timesheet notifications
// ---------------------------------------------------------------------------

interface NotifyTimesheetSubmittedArgs {
  cafeId: string;
  partTimerName: string;
  monthYear: string;
}

/** Notify all managers + owners of this cafe that a part-timer submitted a timesheet. */
export async function notifyTimesheetSubmitted(args: NotifyTimesheetSubmittedArgs): Promise<void> {
  const [recipients, slug] = await Promise.all([
    getManagerRecipients(args.cafeId),
    getCafeSlug(args.cafeId),
  ]);
  if (recipients.length === 0) return;

  const reviewUrl = slug ? `${baseUrl()}/c/${slug}/admin/timesheets` : baseUrl();
  const text = `🕒 <b>New Timesheet Submitted</b>\n\n${esc(args.partTimerName)} submitted their ${formatMonthYear(args.monthYear)} timesheet for review.\n\nReview: ${reviewUrl}`;

  await Promise.all(recipients.map((chatId) => sendTelegram(chatId, text)));
}

interface NotifyTimesheetForOwnerArgs {
  cafeId: string;
  partTimerName: string;
  managerName: string;
  monthYear: string;
}

/** Notify owners of this cafe that a manager approved a timesheet (now awaiting owner). */
export async function notifyTimesheetForOwner(args: NotifyTimesheetForOwnerArgs): Promise<void> {
  const [recipients, slug] = await Promise.all([
    getOwnerRecipients(args.cafeId),
    getCafeSlug(args.cafeId),
  ]);
  if (recipients.length === 0) return;

  const reviewUrl = slug ? `${baseUrl()}/c/${slug}/admin/timesheets` : baseUrl();
  const text = `📋 <b>Timesheet Awaiting Owner Approval</b>\n\n${esc(args.managerName)} approved ${esc(args.partTimerName)}'s ${formatMonthYear(args.monthYear)} timesheet. Final approval needed.\n\nReview: ${reviewUrl}`;

  await Promise.all(recipients.map((chatId) => sendTelegram(chatId, text)));
}

interface NotifyTimesheetDecisionArgs {
  partTimerUserId: string;
  monthYear: string;
  approved: boolean;
  rejectionReason?: string | null;
}

/** Notify the part-timer of a final approval or rejection. */
export async function notifyTimesheetDecision(args: NotifyTimesheetDecisionArgs): Promise<void> {
  const { rows } = await sql<{ telegram_chat_id: string }>`
    SELECT telegram_chat_id FROM profiles
     WHERE id = ${args.partTimerUserId}
       AND telegram_chat_id IS NOT NULL
     LIMIT 1
  `;
  if (rows.length === 0) return;

  const icon = args.approved ? '✅' : '❌';
  const verb = args.approved ? 'approved' : 'rejected';
  const reasonLine = !args.approved && args.rejectionReason
    ? `\n\nReason: ${esc(args.rejectionReason)}`
    : '';
  const text = `${icon} <b>Timesheet ${verb.charAt(0).toUpperCase() + verb.slice(1)}</b>\n\nYour ${formatMonthYear(args.monthYear)} timesheet has been <b>${verb}</b>.${reasonLine}`;

  await sendTelegram(rows[0].telegram_chat_id, text);
}

// ---------------------------------------------------------------------------
// Onboarding notifications
// ---------------------------------------------------------------------------

interface NotifyCafeSignupArgs {
  cafeName: string;
  ownerName: string;
  ownerPhone: string;
}

/** Alert a cafe's owners that a subscription payment failed, so they can fix billing. */
export async function notifyPaymentFailed(subscriptionId: string): Promise<void> {
  const { rows: cafeRows } = await sql<{ id: string; name: string; slug: string }>`
    SELECT id, name, slug FROM cafes WHERE stripe_subscription_id = ${subscriptionId} LIMIT 1
  `;
  if (cafeRows.length === 0) return;
  const cafe = cafeRows[0];
  const recipients = await getOwnerRecipients(cafe.id);
  if (recipients.length === 0) {
    console.warn(`notifyPaymentFailed: no linked owner recipients for cafe ${cafe.id}`);
    return;
  }
  const text = `⚠️ <b>Payment Failed</b>\n\nA payment for <b>${esc(cafe.name)}</b> could not be processed. Please update your billing details to avoid an interruption in service.\n\nBilling: ${baseUrl()}/c/${cafe.slug}/billing`;
  await Promise.all(recipients.map((chatId) => sendTelegram(chatId, text)));
}

/** Notify all super admins that a new cafe has applied for access. */
export async function notifyCafeSignup(args: NotifyCafeSignupArgs): Promise<void> {
  const { rows } = await sql<{ telegram_chat_id: string }>`
    SELECT telegram_chat_id FROM profiles
     WHERE is_super_admin = TRUE
       AND is_active = TRUE
       AND telegram_chat_id IS NOT NULL
  `;
  if (rows.length === 0) return;

  const reviewUrl = `${baseUrl()}/super`;
  const text = `🆕 <b>New Cafe Application</b>\n\n<b>${esc(args.cafeName)}</b>\nOwner: ${esc(args.ownerName)} (${esc(args.ownerPhone)})\n\nReview: ${reviewUrl}`;

  await Promise.all(rows.map((r) => sendTelegram(r.telegram_chat_id, text)));
}
