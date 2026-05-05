import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import * as path from 'path';
import { fmt12 } from '@/lib/timeUtils';
import { sql } from '@/lib/db';
import { requireTenantUser, AuthError } from '@/lib/auth';
import type { TimesheetEntry } from '@/lib/database.types';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TimesheetExportRow {
  id: string;
  user_id: string;
  month_year: string;
  employee_signature: string | null;
  manager_signature: string | null;
  full_name: string | null;
  email: string | null;
  phone_e164: string | null;
  hourly_rate: string | null;
}

// ─── Timesheet sheet layout (exceljs 1-indexed rows, letter columns) ──────────
//   Row 3  B3:C3  "NAME OF STAFF :"  → value in D3
//   Row 5  B5:C5  "MONTH-YEAR :"     → value in D5
//   Row 7  B7:C7  "Contact No:"      → value in D7
//   Rows 10-12    Column headers (DATE, DAY, START, END, BREAK, TOTAL, REMARKS)
//   Rows 13-43    Day rows (Day N = row 12+N)
//                 B=date DD/MM/YY  C=day  D=start  E=end  F=break  G=total  H=remarks
//   Row 44  B44:F44  "TOTAL" → value in G44
//   Row 46  "COMMENTS :"
//   Rows 49-53  Signature box outlines (bordered cells):
//                 Casual worker box B49:D53 — image anchored here
//                 Head of café   box G49:H53 — image anchored here
//   Row 54  B54 "CASUAL WORKER SIGNATURE"  G54 "HEAD OF CAFÉ SIGNATURE / COMPANY STAMP & DATE"

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
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireTenantUser();
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const { rows } = await sql<TimesheetExportRow>`
      SELECT t.id, t.user_id, t.month_year, t.employee_signature, t.manager_signature,
             p.full_name, p.email, p.phone_e164, p.hourly_rate
        FROM timesheets t
        JOIN profiles p ON p.id = t.user_id
       WHERE t.id = ${id}
         AND t.cafe_id = ${ctx.cafeId}
       LIMIT 1
    `;
    const timesheet = rows[0];
    if (!timesheet) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const isAdmin = ctx.role === 'manager' || ctx.role === 'owner';
    if (timesheet.user_id !== ctx.userId && !isAdmin) {
      throw new AuthError('forbidden', 'Cannot export this timesheet');
    }

    const { rows: entryRows } = await sql<TimesheetEntry>`
      SELECT id, timesheet_id, entry_date::text AS entry_date,
             start_time::text AS start_time, end_time::text AS end_time,
             break_hours, total_hours, remarks, created_at
        FROM timesheet_entries
       WHERE timesheet_id = ${id}
         AND cafe_id = ${ctx.cafeId}
       ORDER BY entry_date ASC
    `;

    const staffName: string  = timesheet.full_name ?? timesheet.email ?? 'Unknown';
    const contactNo: string  = timesheet.phone_e164 ?? '';
    const hourlyRate: number | null =
      timesheet.hourly_rate === null ? null : Number(timesheet.hourly_rate);
    const [year, monthIdx]   = timesheet.month_year.split('-').map(Number);
    const monthLabel         = `${MONTH_NAMES[monthIdx - 1]}${String(year).slice(2)}`;
    const daysInMonth        = new Date(year, monthIdx, 0).getDate();

    const entryByDay: Record<number, TimesheetEntry> = {};
    for (const e of entryRows) {
      entryByDay[parseInt(e.entry_date.split('-')[2])] = e;
    }
    const totalHours = entryRows.reduce((s: number, e: TimesheetEntry) => s + Number(e.total_hours ?? 0), 0);

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

    // ── Employee signature ─────────────────────────────────────────────────────
    const employeeSig: string | null = timesheet.employee_signature ?? null;
    if (employeeSig) {
      const empSigId = wb.addImage({
        base64: stripDataUrl(employeeSig),
        extension: 'png',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exceljs types lack editAs
      ws.addImage(empSigId, { tl: { col: 1, row: 48 }, br: { col: 4, row: 53 }, editAs: 'oneCell' } as any);
    }

    // ── Manager signature ──────────────────────────────────────────────────────
    const managerSig: string | null = timesheet.manager_signature ?? null;
    if (managerSig) {
      const mgrSigId = wb.addImage({
        base64: stripDataUrl(managerSig),
        extension: 'png',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exceljs types lack editAs
      ws.addImage(mgrSigId, { tl: { col: 6, row: 48 }, br: { col: 8, row: 53 }, editAs: 'oneCell' } as any);
    }

    // ── Output ─────────────────────────────────────────────────────────────────
    const buf = await wb.xlsx.writeBuffer();

    // Post-process the zip to work around two exceljs bugs that make
    // Excel flag the output as "unreadable content":
    //
    //  1. A stray <Default Extension="vml"> is added to [Content_Types].xml
    //     even though no VML parts exist in the archive.
    //  2. When addImage() is called on a worksheet whose drawing already
    //     contains a picture, exceljs clones the template picture's
    //     <a:extLst> metadata — including its creationId GUID — onto every
    //     new picture. Multiple pictures sharing the same creationId make
    //     the drawing invalid. The extLst block is optional, so the
    //     simplest fix is to strip it from every drawing XML part.
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

    const drawingFiles = Object.keys(zip.files).filter(
      (name) => /^xl\/drawings\/drawing\d+\.xml$/.test(name),
    );
    for (const name of drawingFiles) {
      const file = zip.file(name);
      if (!file) continue;
      const xml = await file.async('string');
      const patched = xml.replace(/<a:extLst>[\s\S]*?<\/a:extLst>/g, '');
      if (patched !== xml) zip.file(name, patched);
    }

    const outBuf = await zip.generateAsync({ type: 'nodebuffer' });

    const filename = `${staffName.replace(/\s+/g, '-')}-${timesheet.month_year}.xlsx`;
    // ASCII fallback strips chars that would break the quoted-string token;
    // filename* (RFC 5987) carries the full UTF-8 name for clients that support it.
    const asciiFilename = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\\r\n]/g, '_');

    return new NextResponse(new Uint8Array(outBuf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('timesheets export error', e);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
