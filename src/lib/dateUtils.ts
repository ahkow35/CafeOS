// src/lib/dateUtils.ts

const SHORT_MONTH = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const LONG_MONTH  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/**
 * Format "YYYY-MM-DD" → "15 Jan 2026" (used in DecisionTicket, approval screens).
 * Uses noon time to avoid DST/timezone shifts on date boundaries.
 */
export function formatDateLong(dateString: string): string {
  const date = new Date(dateString + 'T12:00:00');
  return `${date.getDate().toString().padStart(2,'0')} ${SHORT_MONTH[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * Format "YYYY-MM-DD" → "Jan 15" (used in LeaveRequestCard).
 * Uses noon time to avoid DST/timezone shifts on date boundaries.
 */
export function formatDateShort(dateString: string): string {
  const date = new Date(dateString + 'T12:00:00');
  return `${SHORT_MONTH[date.getMonth()]} ${date.getDate()}`;
}

/**
 * Format "YYYY-MM" → "Jan 2026" (used in timesheet list pages).
 */
export function formatMonthYear(monthYear: string): string {
  const [year, month] = monthYear.split('-');
  return `${SHORT_MONTH[parseInt(month) - 1]} ${year}`;
}

/**
 * Format "YYYY-MM" → "January 2026" (used in timesheet detail header).
 */
export function formatMonthYearLong(monthYear: string): string {
  const [year, month] = monthYear.split('-');
  return `${LONG_MONTH[parseInt(month) - 1]} ${year}`;
}
