import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import * as path from 'path';
import { fmt12 } from '@/lib/timeUtils';

// ─── Timesheet sheet layout (exceljs 1-indexed rows, letter columns) ──────────
//   Row 3  B3:C3  "NAME OF STAFF :"  → value in D3
//   Row 5  B5:C5  "MONTH-YEAR :"     → value in D5
//   Row 7  B7:C7  "Contact No:"      → value in D7
//   Rows 10-12    Column headers (DATE, DAY, START, END, BREAK, TOTAL, REMARKS)
//   Rows 13-43    Day rows (Day N = row 12+N)
//                 B=date DD/MM/YY  C=day  D=start  E=end  F=break  G=total  H=remarks
//   Row 44  B44:F44  "TOTAL" → value in G44
//   Row 46  "COMMENTS :"
//   Row 51  "HEAD OF CAFÉ SIGNATURE / COMPANY STAMP & DATE"
//   Rows 52-60  Employee signature area (image placed here)
//   Rows 61-69  Manager signature area (image placed here)

const MONTH_NAMES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth() + 1).padStart(2,'0');
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}/${mm}/${yy}`;
}

function dayName(dateStr: string): string {
  return DAYS[new Date(dateStr + 'T00:00:00').getDay()];
}

function stripDataUrl(dataUrl: string): string {
  return dataUrl.replace(/^data:image\/\w+;base64,/, '');
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
  const staffName: string  = profile.full_name ?? profile.email ?? 'Unknown';
  const contactNo: string  = profile.phone ?? '';
  const hourlyRate: number | null = profile.hourly_rate ?? null;
  const [year, monthIdx]   = (ts as any).month_year.split('-').map(Number);
  const monthLabel         = `${MONTH_NAMES[monthIdx - 1]}${String(year).slice(2)}`; // e.g. APR26
  const daysInMonth        = new Date(year, monthIdx, 0).getDate();

  const entryByDay: Record<number, any> = {};
  for (const e of (entries ?? []) as any[]) {
    entryByDay[parseInt(e.entry_date.split('-')[2])] = e;
  }
  const totalHours = (entries ?? []).reduce((s: number, e: any) => s + (e.total_hours ?? 0), 0);

  // ── Load XLSX template ─────────────────────────────────────────────────────
  const templatePath = path.join(process.cwd(), 'docs', 'RoundboyRoasters Timesheet.xlsx');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(templatePath);
  const ws = wb.getWorksheet('Timesheet')!;

  // ── Header fields ──────────────────────────────────────────────────────────
  ws.getCell('D3').value = staffName;
  ws.getCell('D5').value = monthLabel;
  ws.getCell('D7').value = contactNo;

  // ── Day rows ───────────────────────────────────────────────────────────────
  for (let day = 1; day <= daysInMonth; day++) {
    const rowNum = 12 + day; // Day 1 → row 13, Day 31 → row 43
    const dateStr = `${year}-${String(monthIdx).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const entry = entryByDay[day];

    ws.getCell(`B${rowNum}`).value = fmtDate(dateStr);
    ws.getCell(`C${rowNum}`).value = dayName(dateStr);

    if (entry) {
      if (entry.start_time) ws.getCell(`D${rowNum}`).value = fmt12(entry.start_time);
      if (entry.end_time)   ws.getCell(`E${rowNum}`).value = fmt12(entry.end_time);
      if (entry.break_hours != null) ws.getCell(`F${rowNum}`).value = entry.break_hours;
      if (entry.total_hours != null) ws.getCell(`G${rowNum}`).value = entry.total_hours;
      if (entry.remarks)    ws.getCell(`H${rowNum}`).value = entry.remarks;
    }
  }

  // ── Total ──────────────────────────────────────────────────────────────────
  ws.getCell('G44').value = totalHours;

  // ── Salary note in comments area ───────────────────────────────────────────
  if (hourlyRate !== null) {
    ws.getCell('B47').value =
      `${totalHours} hrs × $${hourlyRate.toFixed(2)}/hr = $${(totalHours * hourlyRate).toFixed(2)}`;
  }

  // ── Logo lives in the template itself — no need to re-add here. ───────────

  // ── Employee signature ─────────────────────────────────────────────────────
  const employeeSig: string | null = (ts as any).employee_signature ?? null;
  if (employeeSig) {
    const empSigId = wb.addImage({
      base64: stripDataUrl(employeeSig),
      extension: 'png',
    });
    // Left side of signature area: cols B–E (indices 1–4), rows 53–61 (indices 52–60)
    ws.addImage(empSigId, {
      tl: { col: 1, row: 52 },
      br: { col: 4, row: 60 },
      editAs: 'oneCell',
    } as any);
  }

  // ── Manager signature ──────────────────────────────────────────────────────
  const managerSig: string | null = (ts as any).manager_signature ?? null;
  if (managerSig) {
    const mgrSigId = wb.addImage({
      base64: stripDataUrl(managerSig),
      extension: 'png',
    });
    // Right side of signature area: cols F–I (indices 5–8), rows 53–61 (indices 52–60)
    ws.addImage(mgrSigId, {
      tl: { col: 5, row: 52 },
      br: { col: 8, row: 60 },
      editAs: 'oneCell',
    } as any);
  }

  // ── Output ─────────────────────────────────────────────────────────────────
  const buf = await wb.xlsx.writeBuffer();

  // exceljs declares a Default Extension="vml" entry in [Content_Types].xml
  // even when no VML parts exist in the archive. Excel flags this as
  // "unreadable content" on open. Strip the stray declaration.
  const zip = await JSZip.loadAsync(buf as ArrayBuffer);
  const ctFile = zip.file('[Content_Types].xml');
  if (ctFile) {
    const ct = await ctFile.async('string');
    const patched = ct.replace(
      /<Default Extension="vml" ContentType="application\/vnd\.openxmlformats-officedocument\.vmlDrawing"\s*\/>/,
      '',
    );
    if (patched !== ct) zip.file('[Content_Types].xml', patched);
  }
  const outBuf = await zip.generateAsync({ type: 'nodebuffer' });

  const filename = `${staffName.replace(/\s+/g, '-')}-${(ts as any).month_year}.xlsx`;

  return new NextResponse(new Uint8Array(outBuf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
