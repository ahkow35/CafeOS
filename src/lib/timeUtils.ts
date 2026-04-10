// src/lib/timeUtils.ts

/**
 * Parse flexible user time input into HH:MM (24h).
 * Accepts: "9:30am", "9am", "9:30", "13:30", "0930", "930"
 * Returns null if unrecognised.
 */
export function parseTimeInput(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;

  // "9:30am" / "9:30pm"
  let m = s.match(/^(\d{1,2}):(\d{2})(am|pm)$/);
  if (m) {
    let h = parseInt(m[1]), min = parseInt(m[2]);
    if (m[3] === 'am' && h === 12) h = 0;
    if (m[3] === 'pm' && h !== 12) h += 12;
    if (h < 24 && min < 60) return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
  }

  // "9am" / "9pm"
  m = s.match(/^(\d{1,2})(am|pm)$/);
  if (m) {
    let h = parseInt(m[1]);
    if (m[2] === 'am' && h === 12) h = 0;
    if (m[2] === 'pm' && h !== 12) h += 12;
    if (h < 24) return `${String(h).padStart(2,'0')}:00`;
  }

  // "9:30" / "13:30" 24h
  m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = parseInt(m[1]), min = parseInt(m[2]);
    if (h < 24 && min < 60) return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
  }

  // "0930" / "930" / "2130"
  m = s.match(/^(\d{3,4})$/);
  if (m) {
    const padded = m[1].padStart(4, '0');
    const h = parseInt(padded.slice(0,2)), min = parseInt(padded.slice(2));
    if (h < 24 && min < 60) return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
  }

  return null;
}

/** Snap HH:MM to the nearest 15-minute interval. */
export function snapTo15(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  let snapped = Math.round(m / 15) * 15;
  let hour = h;
  if (snapped === 60) { snapped = 0; hour = (h + 1) % 24; }
  return `${String(hour).padStart(2,'0')}:${String(snapped).padStart(2,'0')}`;
}

/** Format HH:MM (24h) as "9:30 AM" / "1:00 PM". */
export function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2,'0')} ${period}`;
}

/**
 * Compute net hours worked (rounded to nearest 0.25h).
 * Handles overnight shifts. Break is subtracted in hours.
 */
export function computeHours(start: string, end: string, brk: number): number {
  const startParts = start.split(':').map(Number);
  const endParts = end.split(':').map(Number);
  if (startParts.length !== 2 || endParts.length !== 2) return 0;
  const [sh, sm] = startParts;
  const [eh, em] = endParts;
  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return 0;
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  const rounded = Math.round((mins / 60) / 0.25) * 0.25;
  return Math.max(0, rounded - brk);
}

/** Return all YYYY-MM-DD strings for every day in a "YYYY-MM" month. */
export function getDaysInMonth(monthYear: string): string[] {
  const [y, m] = monthYear.split('-').map(Number);
  // Day 0 of "next" month (m is already 1-indexed, so it acts as next month in JS's 0-indexed API)
  const count = new Date(y, m, 0).getDate();
  return Array.from({ length: count }, (_, i) =>
    `${y}-${String(m).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`
  );
}

/** True if the date string (YYYY-MM-DD) falls on Saturday or Sunday. */
export function isWeekend(dateStr: string): boolean {
  const dow = new Date(dateStr + 'T00:00:00').getDay();
  return dow === 0 || dow === 6;
}

/** True if the date string (YYYY-MM-DD) is today's local date. */
export function isToday(dateStr: string): boolean {
  return new Date().toLocaleDateString('en-CA') === dateStr;
}
