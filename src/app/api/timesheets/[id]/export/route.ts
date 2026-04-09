import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}/${mm}/${yy}`;
}

function getDayName(dateStr: string): string {
  return DAYS[new Date(dateStr + 'T00:00:00').getDay()];
}

function formatMonthYear(monthYear: string): string {
  const [year, month] = monthYear.split('-');
  return `${MONTH_NAMES[parseInt(month) - 1].toUpperCase()}${year.slice(2)}`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Use service role to bypass RLS for admin export
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
  const monthYear: string = formatMonthYear((ts as any).month_year);
  const totalHours: number = (entries ?? []).reduce((sum: number, e: any) => sum + (e.total_hours ?? 0), 0);

  const wb = XLSX.utils.book_new();
  const wsData: (string | number | null)[][] = [];

  // Row 1: Name
  wsData.push(['NAME OF STAFF :', staffName, '', '', '', '', '']);
  // Row 2: Month-Year
  wsData.push(['MONTH-YEAR (MMMYY) :', monthYear, '', '', '', '', '']);
  // Row 3: Contact
  wsData.push(['Contact No:', contactNo, '', '', '', '', '']);
  // Row 4: blank
  wsData.push(['', '', '', '', '', '', '']);

  // Header row
  wsData.push(['DATE\n(DD/MM/YY)', 'DAY\n(Mon, Tue, etc)', 'START Time\n(am/pm)', 'END Time\n(am/pm)', 'BREAK\n(No of Hours)', 'Total Hours\nless Break time', 'REMARKS']);

  // Entry rows
  for (const entry of (entries ?? []) as any[]) {
    wsData.push([
      formatDate(entry.entry_date),
      getDayName(entry.entry_date),
      entry.start_time ?? '',
      entry.end_time ?? '',
      entry.break_hours ?? 0,
      entry.total_hours ?? 0,
      entry.remarks ?? '',
    ]);
  }

  // Empty rows to fill up to at least 20 data rows
  const dataRowCount = (entries ?? []).length;
  for (let i = dataRowCount; i < 20; i++) {
    wsData.push(['', '', '', '', '', '', '']);
  }

  // Total row
  wsData.push(['TOTAL', '', '', '', '', totalHours, '']);

  // Comments row
  wsData.push(['COMMENTS :', '', '', '', '', '', '']);

  // Blank
  wsData.push(['', '', '', '', '', '', '']);

  // Signature line
  wsData.push(['HEAD OF CAFÉ SIGNATURE / COMPANY STAMP & DATE', '', '', '', '', '', '']);

  // Salary calc if available
  if (hourlyRate !== null) {
    wsData.push(['', '', '', '', '', '', `${totalHours}HRS x $${hourlyRate} = $${(totalHours * hourlyRate).toFixed(2)}`]);
  }

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Column widths
  ws['!cols'] = [
    { wch: 14 }, // Date
    { wch: 10 }, // Day
    { wch: 12 }, // Start
    { wch: 12 }, // End
    { wch: 12 }, // Break
    { wch: 14 }, // Total
    { wch: 40 }, // Remarks
  ];

  // Style header row (row index 4, 0-based)
  const headerRowIdx = 4;
  const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  cols.forEach(col => {
    const cell = ws[`${col}${headerRowIdx + 1}`];
    if (cell) {
      cell.s = {
        font: { bold: true },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        fill: { fgColor: { rgb: 'D9D9D9' } },
        border: {
          top: { style: 'thin' }, bottom: { style: 'thin' },
          left: { style: 'thin' }, right: { style: 'thin' },
        },
      };
    }
  });

  // Style total row
  const totalRowIdx = headerRowIdx + 1 + Math.max((entries ?? []).length, 20);
  const totalCell = ws[`F${totalRowIdx + 1}`];
  if (totalCell) {
    totalCell.s = { font: { bold: true }, alignment: { horizontal: 'center' } };
  }
  const totalLabelCell = ws[`A${totalRowIdx + 1}`];
  if (totalLabelCell) {
    totalLabelCell.s = { font: { bold: true } };
  }

  // Try to embed RBR logo as image (xlsx-js-style supports this)
  try {
    const logoPath = path.join(process.cwd(), 'public', 'rbr-logo.png');
    if (fs.existsSync(logoPath)) {
      const logoData = fs.readFileSync(logoPath);
      const logoBase64 = logoData.toString('base64');
      if (!ws['!images']) ws['!images'] = [];
      (ws['!images'] as any[]).push({
        name: 'rbr-logo.png',
        data: logoBase64,
        opts: { base64: true },
        position: {
          type: 'twoCellAnchor',
          attrs: { editAs: 'oneCell' },
          from: { col: 5, row: 0, colOff: 0, rowOff: 0 },
          to: { col: 7, row: 3, colOff: 0, rowOff: 0 },
        },
      });
    }
  } catch {
    // Logo embedding optional — continue without it
  }

  XLSX.utils.book_append_sheet(wb, ws, 'Timesheet');

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
