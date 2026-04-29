import { NextResponse } from 'next/server';
import { sql, withTx } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/auth';
import { ValidationError } from '@/lib/validators';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

interface EntryRow {
  id: string;
  timesheet_id: string;
  entry_date: string;
  start_time: string | null;
  end_time: string | null;
  break_hours: number;
  total_hours: number;
  remarks: string | null;
  created_at: string;
}

interface TimesheetRow {
  id: string;
  user_id: string;
  status: 'draft' | 'submitted' | 'pending_owner' | 'approved' | 'rejected';
}

function parseTime(input: unknown): string | null {
  if (input == null) return null;
  if (typeof input !== 'string' || !TIME_RE.test(input)) {
    throw new ValidationError('start_time/end_time must be HH:MM[:SS]');
  }
  return input.length === 5 ? `${input}:00` : input;
}

function parseHours(input: unknown, label: string): number {
  if (input == null || input === '') return 0;
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0) throw new ValidationError(`${label} must be a non-negative number`);
  return n;
}

/**
 * POST /api/timesheets/[id]/entries
 * Body: { entry_date, start_time?, end_time?, break_hours?, total_hours, remarks? }
 * Auth: owner-of-timesheet, only while draft.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser();
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { rows: tsRows } = await sql<TimesheetRow>`
      SELECT id, user_id, status FROM timesheets WHERE id = ${id} LIMIT 1
    `;
    const ts = tsRows[0];
    if (!ts) return NextResponse.json({ error: 'Timesheet not found' }, { status: 404 });
    if (ts.user_id !== me.id) throw new AuthError('forbidden', 'Only the owner can edit entries');
    if (ts.status !== 'draft') throw new ValidationError('Entries can only be edited while in draft');

    if (typeof body.entry_date !== 'string' || !DATE_RE.test(body.entry_date)) {
      throw new ValidationError('entry_date must be YYYY-MM-DD');
    }
    const entry_date = body.entry_date;
    const start_time = parseTime(body.start_time);
    const end_time = parseTime(body.end_time);
    const break_hours = parseHours(body.break_hours, 'break_hours');
    const total_hours = parseHours(body.total_hours, 'total_hours');
    const remarks = body.remarks == null || body.remarks === ''
      ? null
      : String(body.remarks).trim() || null;

    const created = await withTx(me.id, async (tx) => {
      const r = await tx.query<EntryRow>(
        `INSERT INTO timesheet_entries
           (timesheet_id, entry_date, start_time, end_time, break_hours, total_hours, remarks)
         VALUES ($1, $2::date, $3::time, $4::time, $5, $6, $7)
         ON CONFLICT (timesheet_id, entry_date) DO UPDATE SET
           start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time,
           break_hours = EXCLUDED.break_hours,
           total_hours = EXCLUDED.total_hours,
           remarks = EXCLUDED.remarks
         RETURNING id, timesheet_id, entry_date::text AS entry_date,
                   start_time::text AS start_time, end_time::text AS end_time,
                   break_hours, total_hours, remarks, created_at`,
        [id, entry_date, start_time, end_time, break_hours, total_hours, remarks],
      );
      return r.rows[0];
    });

    return NextResponse.json({ entry: {
      ...created,
      break_hours: Number(created.break_hours),
      total_hours: Number(created.total_hours),
    } }, { status: 201 });
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('timesheet-entries POST error', e);
    return NextResponse.json({ error: 'Failed to save entry' }, { status: 500 });
  }
}
