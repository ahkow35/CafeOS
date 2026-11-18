/** Timesheet entries: add, edit and delete are allowed only to the owner of a DRAFT timesheet. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { api, env, row, type Person } from '../harness';
import { expectStatus } from './util';
import { seedSheet } from './timesheets';

type Status = 'draft' | 'submitted' | 'pending_owner' | 'approved' | 'rejected';
const STATUSES: Status[] = ['draft', 'submitted', 'pending_owner', 'approved', 'rejected'];
const ACTORS = ['pt', 'staff', 'mgr', 'owner'] as const;

// Allowed only for the person the timesheet belongs to, and only while it is a draft.
const EXPECT = (from: Status, i: number): 200 | 201 | 400 | 403 => (i === 0 ? (from === 'draft' ? 200 : 400) : 403);

async function seedEntry(sheetId: string): Promise<string> {
  const r = await row<{ id: string }>(
    `INSERT INTO timesheet_entries (cafe_id, timesheet_id, entry_date, start_time, end_time, break_hours, total_hours)
     SELECT cafe_id, id, (month_year || '-10')::date, '09:00', '17:00', 0, 8 FROM timesheets WHERE id = $1 RETURNING id`,
    [sheetId],
  );
  return r!.id;
}

async function month(sheetId: string): Promise<string> {
  return (await row<{ month_year: string }>(`SELECT month_year FROM timesheets WHERE id = $1`, [sheetId]))!.month_year;
}

export function timesheetEntryCases(): void {
  describe('timesheet entries: who and when', () => {
    for (const from of STATUSES) {
      ACTORS.forEach((actor, i) => {
        const ok = EXPECT(from, i) === 200;
        const who = (pt: Person) => ({ pt, staff: env.people.staff, mgr: env.people.manager, owner: env.people.owner }[actor]);
        test(`add entry on ${from} as ${actor} -> ${ok ? 201 : EXPECT(from, i)}`, async () => {
          const { id, pt } = await seedSheet(from);
          const r = await api('POST', `/api/timesheets/${id}/entries`, { as: who(pt), body: { entry_date: `${(await month(id))}-05`, start_time: '09:00', end_time: '13:00' } });
          expectStatus(r, ok ? 201 : EXPECT(from, i));
          const n = (await row(`SELECT count(*)::int AS n FROM timesheet_entries WHERE timesheet_id = $1`, [id]))?.n;
          assert.equal(n, ok ? 1 : 0);
        });
        test(`edit entry on ${from} as ${actor} -> ${EXPECT(from, i)}`, async () => {
          const { id, pt } = await seedSheet(from);
          const entry = await seedEntry(id);
          const r = await api('PATCH', `/api/timesheet-entries/${entry}`, { as: who(pt), body: { remarks: 'edited' } });
          expectStatus(r, EXPECT(from, i));
          assert.equal((await row(`SELECT remarks FROM timesheet_entries WHERE id = $1`, [entry]))?.remarks, ok ? 'edited' : null);
        });
        test(`delete entry on ${from} as ${actor} -> ${EXPECT(from, i)}`, async () => {
          const { id, pt } = await seedSheet(from);
          const entry = await seedEntry(id);
          const r = await api('DELETE', `/api/timesheet-entries/${entry}`, { as: who(pt) });
          expectStatus(r, EXPECT(from, i));
          const left = (await row(`SELECT count(*)::int AS n FROM timesheet_entries WHERE id = $1`, [entry]))?.n;
          assert.equal(left, ok ? 0 : 1);
        });
      });
    }
  });

  describe('timesheet entries: values', () => {
    test('total hours are derived from the times and break; a client total is ignored', async () => {
      const { id, pt } = await seedSheet('draft');
      const r = await api('POST', `/api/timesheets/${id}/entries`, { as: pt, body: { entry_date: `${await month(id)}-06`, start_time: '09:00', end_time: '17:00', break_hours: 1, total_hours: 99, remarks: ' ok ' } });
      expectStatus(r, 201);
      assert.deepEqual(
        [r.json.entry.start_time, r.json.entry.end_time, r.json.entry.break_hours, r.json.entry.total_hours, r.json.entry.remarks],
        ['09:00:00', '17:00:00', 1, 7, 'ok'],
      );
    });

    test('adding the same date again replaces that day (one row)', async () => {
      const { id, pt } = await seedSheet('draft');
      const body = { entry_date: `${await month(id)}-07`, start_time: '10:00', end_time: '12:00' };
      expectStatus(await api('POST', `/api/timesheets/${id}/entries`, { as: pt, body }), 201);
      const r = await api('POST', `/api/timesheets/${id}/entries`, { as: pt, body: { ...body, end_time: '14:00' } });
      expectStatus(r, 201);
      const all = await env.pool.query(`SELECT total_hours FROM timesheet_entries WHERE timesheet_id = $1`, [id]);
      assert.deepEqual(all.rows.map((x) => Number(x.total_hours)), [4]);
    });

    test('a date outside the timesheet month is refused', async () => {
      const { id, pt } = await seedSheet('draft');
      expectStatus(await api('POST', `/api/timesheets/${id}/entries`, { as: pt, body: { entry_date: '2020-01-05' } }), 400);
    });

    test('bad date, bad time and missing timesheet', async () => {
      const { id, pt } = await seedSheet('draft');
      expectStatus(await api('POST', `/api/timesheets/${id}/entries`, { as: pt, body: { entry_date: '5 May' } }), 400);
      expectStatus(await api('POST', `/api/timesheets/${id}/entries`, { as: pt, body: { entry_date: `${await month(id)}-05`, start_time: '9am' } }), 400);
      expectStatus(await api('POST', `/api/timesheets/00000000-0000-4000-8000-000000000000/entries`, { as: pt, body: { entry_date: '3000-01-05' } }), 404);
      expectStatus(await api('POST', `/api/timesheets/not-an-id/entries`, { as: pt, body: {} }), 400);
    });

    test('editing only the break re-derives the total from the stored times', async () => {
      const { id, pt } = await seedSheet('draft');
      const entry = await seedEntry(id);
      const r = await api('PATCH', `/api/timesheet-entries/${entry}`, { as: pt, body: { break_hours: 2, total_hours: 99 } });
      expectStatus(r, 200);
      assert.equal(r.json.entry.total_hours, 6);
      assert.equal(r.json.entry.break_hours, 2);
    });

    test('editing with no known field, or an unknown entry', async () => {
      const { id, pt } = await seedSheet('draft');
      const entry = await seedEntry(id);
      expectStatus(await api('PATCH', `/api/timesheet-entries/${entry}`, { as: pt, body: { total_hours: 5 } }), 400);
      expectStatus(await api('PATCH', `/api/timesheet-entries/00000000-0000-4000-8000-000000000000`, { as: pt, body: { remarks: 'x' } }), 404);
    });

    test('a member of the other cafe cannot see the entry', async () => {
      const { id } = await seedSheet('draft');
      const entry = await seedEntry(id);
      expectStatus(await api('DELETE', `/api/timesheet-entries/${entry}`, { as: env.people.owner2 }), 404);
      assert.equal((await row(`SELECT count(*)::int AS n FROM timesheet_entries WHERE id = $1`, [entry]))?.n, 1);
    });
  });
}
