import { NextResponse } from 'next/server';
import { sql, withTx } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/auth';
import { ValidationError } from '@/lib/validators';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

interface OwnerCheckRow {
  id: string;
  timesheet_id: string;
  user_id: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
}

async function loadOwnership(entryId: string): Promise<OwnerCheckRow | null> {
  const { rows } = await sql<OwnerCheckRow>`
    SELECT te.id, te.timesheet_id, t.user_id, t.status
      FROM timesheet_entries te
      JOIN timesheets t ON t.id = te.timesheet_id
     WHERE te.id = ${entryId}
     LIMIT 1
  `;
  return rows[0] ?? null;
}

function parseTime(input: unknown): string | null | undefined {
  if (input === undefined) return undefined;
  if (input == null) return null;
  if (typeof input !== 'string' || !TIME_RE.test(input)) {
    throw new ValidationError('start_time/end_time must be HH:MM[:SS]');
  }
  return input.length === 5 ? `${input}:00` : input;
}

function parseNumberMaybe(input: unknown, label: string): number | undefined {
  if (input === undefined) return undefined;
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0) throw new ValidationError(`${label} must be a non-negative number`);
  return n;
}

/**
 * PATCH /api/timesheet-entries/[id]
 * Body: any of start_time, end_time, break_hours, total_hours, remarks
 * Auth: owner-of-timesheet only, while parent timesheet is in draft.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

    const owner = await loadOwnership(id);
    if (!owner) return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    if (owner.user_id !== me.id) throw new AuthError('forbidden', 'Only the owner can edit entries');
    if (owner.status !== 'draft') throw new ValidationError('Entries can only be edited while in draft');

    const start_time = 'start_time' in body ? parseTime(body.start_time) : undefined;
    const end_time = 'end_time' in body ? parseTime(body.end_time) : undefined;
    const break_hours = 'break_hours' in body ? parseNumberMaybe(body.break_hours, 'break_hours') : undefined;
    const total_hours = 'total_hours' in body ? parseNumberMaybe(body.total_hours, 'total_hours') : undefined;
    const remarks = 'remarks' in body
      ? (body.remarks == null || body.remarks === '' ? null : String(body.remarks).trim() || null)
      : undefined;

    if (
      start_time === undefined && end_time === undefined && break_hours === undefined
      && total_hours === undefined && remarks === undefined
    ) {
      return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
    }

    const updated = await withTx(me.id, async (tx) => {
      const r = await tx.query<EntryRow>(
        `UPDATE timesheet_entries SET
           start_time  = CASE WHEN $1::boolean THEN $2::time ELSE start_time END,
           end_time    = CASE WHEN $3::boolean THEN $4::time ELSE end_time END,
           break_hours = CASE WHEN $5::boolean THEN $6::numeric ELSE break_hours END,
           total_hours = CASE WHEN $7::boolean THEN $8::numeric ELSE total_hours END,
           remarks     = CASE WHEN $9::boolean THEN $10 ELSE remarks END
         WHERE id = $11
         RETURNING id, timesheet_id, entry_date::text AS entry_date,
                   start_time::text AS start_time, end_time::text AS end_time,
                   break_hours, total_hours, remarks, created_at`,
        [
          start_time !== undefined, start_time ?? null,
          end_time !== undefined, end_time ?? null,
          break_hours !== undefined, break_hours ?? null,
          total_hours !== undefined, total_hours ?? null,
          remarks !== undefined, remarks ?? null,
          id,
        ],
      );
      return r.rows[0];
    });

    return NextResponse.json({ entry: {
      ...updated,
      break_hours: Number(updated.break_hours),
      total_hours: Number(updated.total_hours),
    } });
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('timesheet-entries PATCH error', e);
    return NextResponse.json({ error: 'Failed to update entry' }, { status: 500 });
  }
}

/**
 * DELETE /api/timesheet-entries/[id]
 * Auth: owner-of-timesheet only, while parent timesheet is in draft.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser();
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const owner = await loadOwnership(id);
    if (!owner) return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    if (owner.user_id !== me.id) throw new AuthError('forbidden', 'Only the owner can delete entries');
    if (owner.status !== 'draft') throw new ValidationError('Entries can only be deleted while in draft');

    await sql`DELETE FROM timesheet_entries WHERE id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('timesheet-entries DELETE error', e);
    return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 });
  }
}
