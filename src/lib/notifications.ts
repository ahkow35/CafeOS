import { sql } from '@/lib/db';
import { formatMonthYear } from '@/lib/dateUtils';

const SHORT_DATE = (d: string) => {
  const dt = new Date(d.split('T')[0] + 'T00:00:00');
  return dt.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
};

export async function sendTelegram(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
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

interface NotifyLeaveSubmittedArgs {
  requesterName: string;
  leaveType: 'annual' | 'medical';
  startDate: string;
  endDate: string;
  days: number;
}

/** Notify all managers + owners that a new leave request needs review. */
export async function notifyLeaveSubmitted(args: NotifyLeaveSubmittedArgs): Promise<void> {
  const { rows } = await sql<{ telegram_chat_id: string }>`
    SELECT telegram_chat_id FROM profiles
     WHERE role IN ('manager', 'owner')
       AND is_active = TRUE
       AND telegram_chat_id IS NOT NULL
  `;
  if (rows.length === 0) return;

  const dateRange = args.startDate === args.endDate
    ? SHORT_DATE(args.startDate)
    : `${SHORT_DATE(args.startDate)} – ${SHORT_DATE(args.endDate)}`;

  const text = `📋 <b>New Leave Request</b>\n\n${args.requesterName} has submitted a ${args.days}-day ${args.leaveType} leave request (${dateRange}).\n\nLog in to review: https://cafe-os-six.vercel.app/admin/leave`;

  await Promise.all(rows.map(r => sendTelegram(r.telegram_chat_id, text)));
}

interface NotifyLeaveDecisionArgs {
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
  partTimerName: string;
  monthYear: string;
}

/** Notify all managers + owners that a part-timer submitted a timesheet. */
export async function notifyTimesheetSubmitted(args: NotifyTimesheetSubmittedArgs): Promise<void> {
  const { rows } = await sql<{ telegram_chat_id: string }>`
    SELECT telegram_chat_id FROM profiles
     WHERE role IN ('manager', 'owner')
       AND is_active = TRUE
       AND telegram_chat_id IS NOT NULL
  `;
  if (rows.length === 0) return;

  const text = `🕒 <b>New Timesheet Submitted</b>\n\n${args.partTimerName} submitted their ${formatMonthYear(args.monthYear)} timesheet for review.\n\nLog in to review: https://cafe-os-six.vercel.app/admin/timesheets`;

  await Promise.all(rows.map(r => sendTelegram(r.telegram_chat_id, text)));
}

interface NotifyTimesheetForOwnerArgs {
  partTimerName: string;
  managerName: string;
  monthYear: string;
}

/** Notify all owners that a manager approved a timesheet (now awaiting owner). */
export async function notifyTimesheetForOwner(args: NotifyTimesheetForOwnerArgs): Promise<void> {
  const { rows } = await sql<{ telegram_chat_id: string }>`
    SELECT telegram_chat_id FROM profiles
     WHERE role = 'owner'
       AND is_active = TRUE
       AND telegram_chat_id IS NOT NULL
  `;
  if (rows.length === 0) return;

  const text = `📋 <b>Timesheet Awaiting Owner Approval</b>\n\n${args.managerName} approved ${args.partTimerName}'s ${formatMonthYear(args.monthYear)} timesheet. Final approval needed.\n\nLog in to review: https://cafe-os-six.vercel.app/admin/timesheets`;

  await Promise.all(rows.map(r => sendTelegram(r.telegram_chat_id, text)));
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
    ? `\n\nReason: ${args.rejectionReason}`
    : '';
  const text = `${icon} <b>Timesheet ${verb.charAt(0).toUpperCase() + verb.slice(1)}</b>\n\nYour ${formatMonthYear(args.monthYear)} timesheet has been <b>${verb}</b>.${reasonLine}`;

  await sendTelegram(rows[0].telegram_chat_id, text);
}
