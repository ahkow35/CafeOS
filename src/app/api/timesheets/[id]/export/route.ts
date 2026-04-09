import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

// Timesheet sheet column mapping (0-indexed absolute):
//   B=1  DATE (DD/MM/YY)
//   C=2  DAY (Mon, Tue…)
//   D=3  START time
//   E=4  END time
//   F=5  BREAK (hours)
//   G=6  Total Hours
//   H=7  REMARKS
//
// Header data cells (label spans B:C, value goes in D):
//   D3  (c=3, r=2)  Staff name
//   D5  (c=3, r=4)  Month-Year
//   D7  (c=3, r=6)  Contact No
//
// Day rows: Day N → r = 11 + N  (Day 1 = r=12, Day 31 = r=42)
// Total    → r = 43, col G (c=6)

const MONTH_NAMES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2,'0')} ${period}`;
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth() + 1).padStart(2,'0');
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}/${mm}/${yy}`;
}

function setCell(ws: XLSX.WorkSheet, c: number, r: number, value: string | number) {
  const ref = XLSX.utils.encode_cell({ c, r });
  const t = typeof value === 'number' ? 'n' : 's';
  if (ws[ref]) {
    ws[ref].v = value;
    ws[ref].t = t;
    delete ws[ref].w; // clear cached formatted text
  } else {
    ws[ref] = { v: value, t };
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
  const monthLabel = `${MONTH_NAMES[monthIdx - 1]}${String(year).slice(2)}`; // e.g. "APR26"

  // Entry lookup by day number
  const entryByDay: Record<number, any> = {};
  for (const e of (entries ?? []) as any[]) {
    const day = parseInt(e.entry_date.split('-')[2]);
    entryByDay[day] = e;
  }

  const totalHours: number = (entries ?? []).reduce(
    (sum: number, e: any) => sum + (e.total_hours ?? 0), 0
  );

  // ── Load template ──────────────────────────────────────────────────────────
  const templatePath = path.join(process.cwd(), 'docs', 'RoundboyRoasters Timesheet.xls');
  const templateBuf = fs.readFileSync(templatePath);
  const wb = XLSX.read(templateBuf, { type: 'buffer', cellStyles: true });

  // Use the "Timesheet" sheet
  const ws = wb.Sheets['Timesheet'];

  // ── Header fields ──────────────────────────────────────────────────────────
  setCell(ws, 3, 2, staffName);   // D3  — NAME OF STAFF value
  setCell(ws, 3, 4, monthLabel);  // D5  — MONTH-YEAR value
  setCell(ws, 3, 6, contactNo);   // D7  — Contact No value

  // ── Day rows ───────────────────────────────────────────────────────────────
  const daysInMonth = new Date(year, monthIdx, 0).getDate();

  for (let day = 1; day <= daysInMonth; day++) {
    const r = 11 + day; // Day 1 → r=12, Day 31 → r=42
    const entry = entryByDay[day];
    const dateObj = new Date(year, monthIdx - 1, day);
    const dayName = DAYS[dateObj.getDay()];

    // Always write date and day name
    setCell(ws, 1, r, fmtDate(`${year}-${String(monthIdx).padStart(2,'0')}-${String(day).padStart(2,'0')}`)); // B
    setCell(ws, 2, r, dayName); // C

    if (entry) {
      if (entry.start_time) setCell(ws, 3, r, fmt12(entry.start_time)); // D
      if (entry.end_time)   setCell(ws, 4, r, fmt12(entry.end_time));   // E
      if (entry.break_hours != null) setCell(ws, 5, r, entry.break_hours); // F
      if (entry.total_hours != null) setCell(ws, 6, r, entry.total_hours); // G
      if (entry.remarks)    setCell(ws, 7, r, entry.remarks);              // H
    }
  }

  // ── Total row (r=43, col G) ────────────────────────────────────────────────
  setCell(ws, 6, 43, totalHours); // G44

  // ── Salary note in comments area if rate available ─────────────────────────
  if (hourlyRate !== null) {
    const note = `${totalHours} hrs × $${hourlyRate.toFixed(2)}/hr = $${(totalHours * hourlyRate).toFixed(2)}`;
    setCell(ws, 1, 46, note); // B47 (first line of comments area)
  }

  // ── Output as xlsx ─────────────────────────────────────────────────────────
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
