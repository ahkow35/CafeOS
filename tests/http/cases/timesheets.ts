/** Timesheet approval chain: every (starting status, who, action) move, read back from the database. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { api, env, newMember, row, nextYear, type Person } from '../harness';
import { SIG, byId, expectStatus, pick, stampIs, type Cell } from './util';

type Status = 'draft' | 'submitted' | 'pending_owner' | 'approved' | 'rejected';
const STATUSES: Status[] = ['draft', 'submitted', 'pending_owner', 'approved', 'rejected'];
const ACTORS = ['pt', 'staff', 'mgr', 'owner'] as const; // pt = the person the timesheet belongs to
type Actor = typeof ACTORS[number];

const REASON = 'Hours do not match the roster';
const BODIES: Record<string, Record<string, unknown>> = {
  submit: { status: 'submitted' },
  forward: { status: 'pending_owner', manager_signature: SIG },
  approve: { status: 'approved', manager_signature: SIG },
  reject: { status: 'rejected', rejection_reason: REASON },
  reopen: { status: 'draft' },
};

// Expected result per action and starting status, for [part-timer who owns it, other staff, manager, owner].
const PATCH_TABLE: Record<string, Record<Status, Cell[]>> = {
  submit: {
    draft: ['ok:submitted', 403, 403, 403],
    submitted: [400, 403, 403, 403], pending_owner: [400, 403, 403, 403],
    approved: [400, 403, 403, 403], rejected: [400, 403, 403, 403],
  },
  forward: {
    draft: [403, 403, 400, 400], submitted: [403, 403, 'ok:pending_owner', 'ok:pending_owner'],
    pending_owner: [403, 403, 400, 400], approved: [403, 403, 400, 400], rejected: [403, 403, 400, 400],
  },
  approve: {
    draft: [403, 403, 400, 400], submitted: [403, 403, 403, 'ok:approved'],
    pending_owner: [403, 403, 403, 'ok:approved'], approved: [403, 403, 400, 400], rejected: [403, 403, 400, 400],
  },
  reject: {
    draft: [403, 403, 400, 400], submitted: [403, 403, 'ok:rejected', 'ok:rejected'],
    pending_owner: [403, 403, 403, 'ok:rejected'], approved: [403, 403, 400, 400], rejected: [403, 403, 400, 400],
  },
  reopen: {
    draft: [400, 403, 403, 403], submitted: [400, 403, 403, 403], pending_owner: [400, 403, 403, 403],
    approved: [400, 403, 403, 403], rejected: ['ok:draft', 403, 403, 403],
  },
};

// DELETE /api/timesheets/[id]: 200 removes the row.
const DELETE_TABLE: Record<Status, (200 | 400 | 403)[]> = {
  draft: [200, 403, 200, 200], submitted: [400, 403, 200, 200], pending_owner: [400, 403, 200, 200],
  approved: [400, 403, 400, 400], rejected: [400, 403, 200, 200],
};

const COLS = ['status', 'comments', 'rejection_reason', 'employee_signature', 'manager_signature',
  'manager_action_by', 'approved_by'];

/** Insert a timesheet in the given status for a fresh part-timer, shaped the way the routes leave it. */
export async function seedSheet(status: Status): Promise<{ id: string; pt: Person }> {
  const pt = await newMember('part_timer');
  const y = nextYear();
  const reviewed = status === 'pending_owner' || status === 'approved';
  const r = await row<{ id: string }>(
    `INSERT INTO timesheets (cafe_id, user_id, month_year, status, employee_signature, manager_signature,
                             manager_action_by, manager_action_at, approved_by, approved_at, rejection_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [env.cafe1, pt.id, `${y}-01`, status, SIG, reviewed ? SIG : null,
      reviewed ? env.people.manager.id : null, reviewed ? new Date() : null,
      status === 'approved' ? env.people.owner.id : null, status === 'approved' ? new Date() : null,
      status === 'rejected' ? 'seed reason' : null],
  );
  return { id: r!.id, pt };
}

function actorOf(a: Actor, pt: Person): Person {
  return { pt, staff: env.people.staff, mgr: env.people.manager, owner: env.people.owner }[a];
}

export function timesheetCases(): void {
  describe('timesheets: status moves', () => {
    for (const [action, byStatus] of Object.entries(PATCH_TABLE)) {
      for (const from of STATUSES) {
        ACTORS.forEach((actor, i) => {
          const cell = byStatus[from][i];
          test(`${action} from ${from} as ${actor} -> ${cell}`, async () => {
            const { id, pt } = await seedSheet(from);
            const who = actorOf(actor, pt);
            const before = pick(await byId('timesheets', id), COLS);
            const r = await api('PATCH', `/api/timesheets/${id}`, { as: who, body: BODIES[action] });
            const after = await byId('timesheets', id);
            if (typeof cell === 'number') {
              expectStatus(r, cell);
              assert.deepEqual(pick(after, COLS), before, 'a refused move must leave the row untouched');
              return;
            }
            expectStatus(r, 200);
            const to = cell.slice(3);
            assert.equal(r.json.timesheet.status, to);
            assert.equal(after?.status, to);
            checkStamps(action, from, who, before, after);
          });
        });
      }
    }
  });

  describe('timesheets: delete', () => {
    for (const from of STATUSES) {
      ACTORS.forEach((actor, i) => {
        const http = DELETE_TABLE[from][i];
        test(`delete ${from} as ${actor} -> ${http}`, async () => {
          const { id, pt } = await seedSheet(from);
          const r = await api('DELETE', `/api/timesheets/${id}`, { as: actorOf(actor, pt) });
          expectStatus(r, http);
          assert.equal((await byId('timesheets', id)) === undefined, http === 200);
        });
      });
    }

    test('delete removes the entries too', async () => {
      const { id, pt } = await seedSheet('draft');
      await row(`INSERT INTO timesheet_entries (cafe_id, timesheet_id, entry_date, total_hours) SELECT cafe_id, id, (month_year || '-02')::date, 4 FROM timesheets WHERE id = $1`, [id]);
      expectStatus(await api('DELETE', `/api/timesheets/${id}`, { as: pt }), 200);
      assert.equal((await row(`SELECT count(*)::int AS n FROM timesheet_entries WHERE timesheet_id = $1`, [id]))?.n, 0);
    });
  });
}

/** Which stamp columns each allowed move leaves behind (ids only, never clock values). */
function checkStamps(action: string, from: Status, who: Person, before: Record<string, unknown>, after: Record<string, any> | undefined): void { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (action === 'forward') {
    stampIs(after, 'manager_action_by', who.id);
    assert.equal(after?.manager_signature, SIG);
    stampIs(after, 'approved_by', null);
  } else if (action === 'approve') {
    stampIs(after, 'approved_by', who.id);
    assert.ok(after?.approved_at);
    stampIs(after, 'manager_action_by', from === 'submitted' ? who.id : (before.manager_action_by as string));
  } else if (action === 'reject') {
    assert.equal(after?.rejection_reason, REASON);
    stampIs(after, 'approved_by', null);
  } else if (action === 'reopen') {
    for (const c of ['rejection_reason', 'employee_signature', 'manager_signature', 'manager_action_by', 'manager_action_at']) {
      assert.equal(after?.[c], null, `${c} is cleared on reopen`);
    }
  } else if (action === 'submit') {
    assert.equal(after?.employee_signature, SIG);
  }
}
