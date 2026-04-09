import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const MONTH_NAMES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2,'0')} ${period}`;
}

function setCell(ws: XLSX.WorkSheet, col: number, row: number, value: string | number) {
  const ref = XLSX.utils.encode_cell({ c: col, r: row });
  const existing = ws[ref];
  if (existing) {
    existing.v = value;
    existing.t = typeof value === 'number' ? 'n' : 's';
  } else {
    ws[ref] = { v: value, t: typeof value === 'number' ? 'n' : 's' };
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const [{ data: ts }, { data: entries }] = await Promise.all([
    supabase.from('timesheets').select('*, profiles(full_name, email, phone, hourly_rate)').eq('id', id).single(),
    supabase.from('timesheet_entries').select('*').eq('timesheet_id', id).order('entry_date'),
  ]);

  if (!ts) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const profile = (ts as any).profiles ?? {};
  const staffName: string = profile.full_name ?? profile.email ?? 'Unknown';
  const contactNo: string = profile.phone ?? '';
  const hourlyRate: number | null = profile.hourly_rate ?? null;
  const [year, monthIdx] = (ts as any).month_year.split('-').map(Number);
  const monthLabel = `${MONTH_NAMES[monthIdx - 1]} ${year}`;

  // Build entry lookup by day number
  const entryByDay: Record<number, any> = {};
  for (const e of (entries ?? []) as any[]) {
    const day = parseInt(e.entry_date.split('-')[2]);
    entryByDay[day] = e;
  }

  const totalHours: number = (entries ?? []).reduce((sum: number, e: any) => sum + (e.total_hours ?? 0), 0);

  // ── Load template ──────────────────────────────────────────────────────────
  const templatePath = path.join(process.cwd(), 'docs', 'RoundboyRoasters Timesheet.xls');
  const templateBuf = fs.readFileSync(templatePath);
  const wb = XLSX.read(templateBuf, { type: 'buffer', cellStyles: true });
  const ws = wb.Sheets[wb.SheetNames[0]]; // Sheet1

  // ── Header fields ──────────────────────────────────────────────────────────
  // Row 3 (0-indexed r=2): H column (c=7) → MONTH
  setCell(ws, 7, 2, monthLabel);

  // Row 6 (r=5): A (c=0) → NAME OF CONTRACT STAFF
  setCell(ws, 1, 5, staffName);

  // Row 7 (r=6): A (c=0) → NAME OF COMPANY; H (c=7) → Contact No
  setCell(ws, 1, 6, 'Roundboy Roasters');
  setCell(ws, 7, 6, contactNo);

  // ── Day rows (template rows 12-42 = 0-indexed r=11..41, days 1-31) ────────
  const daysInMonth = new Date(year, monthIdx, 0).getDate();

  for (let day = 1; day <= 31; day++) {
    const r = 11 + (day - 1); // 0-indexed row
    const entry = entryByDay[day];

    if (day > daysInMonth) {
      // Clear day number for months shorter than 31 days
      setCell(ws, 0, r, '');
      continue;
    }

    // Day number is already in template col A; write the day name alongside
    const dateObj = new Date(year, monthIdx - 1, day);
    const dayName = DAYS[dateObj.getDay()];
    // Keep day number in A, annotate with day name in B if no entry
    if (!entry) {
      setCell(ws, 0, r, `${day} ${dayName}`);
      continue;
    }

    // col A: day + day name
    setCell(ws, 0, r, `${day} ${dayName}`);
    // col B (c=1): start time
    if (entry.start_time) setCell(ws, 1, r, fmt12(entry.start_time));
    // col C (c=2): end time
    if (entry.end_time) setCell(ws, 2, r, fmt12(entry.end_time));
    // col D (c=3): break hours
    if (entry.break_hours != null) setCell(ws, 3, r, entry.break_hours);
    // col E (c=4): normal hours (total)
    if (entry.total_hours != null) setCell(ws, 4, r, entry.total_hours);
    // col J (c=9): remarks
    if (entry.remarks) setCell(ws, 9, r, entry.remarks);
  }

  // ── Total row (row 43 = r=42) ──────────────────────────────────────────────
  // Template already has "TOTAL" label in A; put total hours in col E
  setCell(ws, 4, 42, totalHours);

  // ── Salary calc in remarks area if rate available ──────────────────────────
  if (hourlyRate !== null) {
    const salaryNote = `${totalHours} hrs × $${hourlyRate.toFixed(2)}/hr = $${(totalHours * hourlyRate).toFixed(2)}`;
    setCell(ws, 9, 42, salaryNote);
  }

  // ── Write output ───────────────────────────────────────────────────────────
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = `${staffName.replace(/\s+/g, '-')}-${(ts as any).month_year}.xlsx`;

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
