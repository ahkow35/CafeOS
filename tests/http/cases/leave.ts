/** Leave: applying, the two-stage approval, cancel/delete, and the balance after each. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { api, env, newMember, row, nextYear, type Person, type Role } from '../harness';
import { byId, expectStatus, stampIs, type Cell } from './util';

type Status = 'pending_manager' | 'pending_owner' | 'approved' | 'rejected';
const STATUSES: Status[] = ['pending_manager', 'pending_owner', 'approved', 'rejected'];
const DAYS = 2;
const START_BALANCE = 14;

const annual = async (userId: string): Promise<number> =>
  (await row(`SELECT annual_leave_balance AS b FROM cafe_memberships WHERE user_id = $1 AND cafe_id = $2`, [userId, env.cafe1]))!.b;

/** A leave request in the given status for a fresh requester, with the balance the routes would have left. */
async function seedLeave(status: Status, role: Role = 'staff'): Promise<{ id: string; who: Person }> {
  const who = await newMember(role);
  const held = status !== 'rejected'; // a rejected request has already been refunded
  await row(`UPDATE cafe_memberships SET annual_leave_balance = $1 WHERE user_id = $2 AND cafe_id = $3`,
    [START_BALANCE - (held ? DAYS : 0), who.id, env.cafe1]);
  const y = nextYear();
  const r = await row<{ id: string }>(
    `INSERT INTO leave_requests (cafe_id, user_id, leave_type, start_date, end_date, days_requested, status,
                                 manager_action_by, owner_action_by)
     VALUES ($1, $2, 'annual', $3, $4, $5, $6, $7, $8) RETURNING id`,
    [env.cafe1, who.id, `${y}-03-10`, `${y}-03-11`, DAYS, status,
      status === 'pending_owner' ? env.people.manager.id : null, status === 'approved' ? env.people.owner.id : null],
  );
  return { id: r!.id, who };
}

// PATCH {action} by [other staff, manager, owner] on a staff member's request.
const APPROVE: Record<Status, Cell[]> = {
  pending_manager: [403, 'ok:pending_owner', 'ok:approved'], pending_owner: [403, 403, 'ok:approved'],
  approved: [403, 409, 409], rejected: [403, 409, 409],
};
const REJECT: Record<Status, Cell[]> = {
  pending_manager: [403, 'ok:rejected', 'ok:rejected'], pending_owner: [403, 403, 'ok:rejected'],
  approved: [403, 409, 409], rejected: [403, 409, 409],
};
// DELETE by [the requester, other staff, manager, owner]; 200 removes the request.
const DELETE: Record<Status, number[]> = {
  pending_manager: [200, 403, 403, 200], pending_owner: [200, 403, 403, 200],
  approved: [403, 403, 403, 200], rejected: [403, 403, 403, 200],
};

export function leaveCases(): void {
  describe('leave: apply', () => {
    const START: [Role, string, string | null][] = [
      ['staff', 'pending_manager', null], ['part_timer', 'pending_manager', null],
      ['manager', 'pending_owner', null], ['owner', 'approved', 'self'],
    ];
    for (const [role, status, stamp] of START) {
      test(`${role} applies for 3 days -> ${status}, balance ${START_BALANCE} -> ${START_BALANCE - 3}`, async () => {
        const who = await newMember(role);
        const y = nextYear();
        const r = await api('POST', '/api/leave-requests', { as: who, body: { leave_type: 'annual', start_date: `${y}-05-01`, end_date: `${y}-05-03` } });
        expectStatus(r, 201);
        const stored = await byId('leave_requests', r.json.request.id);
        assert.deepEqual([stored?.status, stored?.days_requested, stored?.is_retrospective], [status, 3, false]);
        stampIs(stored, 'owner_action_by', stamp === 'self' ? who.id : null);
        stampIs(stored, 'manager_action_by', null);
        assert.equal(await annual(who.id), START_BALANCE - 3);
      });
    }

    test('a start date in the past is flagged retrospective but still deducts', async () => {
      const who = await newMember('staff');
      const r = await api('POST', '/api/leave-requests', { as: who, body: { leave_type: 'annual', start_date: '2020-01-06', end_date: '2020-01-06' } });
      expectStatus(r, 201);
      assert.equal((await byId('leave_requests', r.json.request.id))?.is_retrospective, true);
      assert.equal(await annual(who.id), START_BALANCE - 1);
    });

    test('refusals leave the balance alone', async () => {
      const who = await newMember('staff');
      const y = nextYear();
      const ask = (b: Record<string, unknown>) => api('POST', '/api/leave-requests', { as: who, body: { leave_type: 'annual', ...b } });
      expectStatus(await ask({ start_date: `${y}-05-01`, end_date: `${y}-05-20` }), 400); // 20 days > 14
      expectStatus(await ask({ start_date: `${y}-05-05`, end_date: `${y}-05-01` }), 400);
      expectStatus(await ask({ start_date: 'soon', end_date: `${y}-05-01` }), 400);
      expectStatus(await api('POST', '/api/leave-requests', { as: who, body: { leave_type: 'sabbatical', start_date: `${y}-05-01`, end_date: `${y}-05-01` } }), 400);
      expectStatus(await api('POST', '/api/leave-requests', { as: who, body: { leave_type: 'medical', start_date: `${y}-05-01`, end_date: `${y}-05-01` } }), 400);
      expectStatus(await api('POST', '/api/leave-requests', { body: { leave_type: 'annual' } }), 401);
      assert.equal(await annual(who.id), START_BALANCE);
    });

    test('overlapping a pending or approved request is refused', async () => {
      const who = await newMember('staff');
      const y = nextYear();
      const body = { leave_type: 'annual', start_date: `${y}-05-01`, end_date: `${y}-05-03` };
      expectStatus(await api('POST', '/api/leave-requests', { as: who, body }), 201);
      expectStatus(await api('POST', '/api/leave-requests', { as: who, body: { ...body, start_date: `${y}-05-03`, end_date: `${y}-05-04` } }), 400);
      assert.equal(await annual(who.id), START_BALANCE - 3);
    });
  });

  describe('leave: approve and reject', () => {
    for (const [action, table] of [['approve', APPROVE], ['reject', REJECT]] as const) {
      for (const from of STATUSES) {
        ['staff', 'manager', 'owner'].forEach((actor, i) => {
          const cell = table[from][i];
          test(`${action} from ${from} as ${actor} -> ${cell}`, async () => {
            const { id, who } = await seedLeave(from);
            const by = env.people[actor as 'staff' | 'manager' | 'owner'];
            const before = await annual(who.id);
            const r = await api('PATCH', `/api/leave-requests/${id}`, { as: by, body: { action } });
            const after = await byId('leave_requests', id);
            if (typeof cell === 'number') {
              expectStatus(r, cell);
              assert.equal(after?.status, from);
              assert.equal(await annual(who.id), before);
              return;
            }
            expectStatus(r, 200);
            const to = cell.slice(3);
            assert.equal(after?.status, to);
            assert.equal(r.json.request.status, to);
            const col = actor === 'manager' ? 'manager_action_by' : 'owner_action_by';
            stampIs(after, col, by.id);
            assert.ok(after?.[col.replace('_by', '_at')]);
            assert.equal(await annual(who.id), to === 'rejected' ? before + DAYS : before);
          });
        });
      }
    }

    test('a manager cannot act on their own request; an owner can', async () => {
      const own = await seedLeave('pending_manager', 'manager');
      for (const action of ['approve', 'reject']) {
        expectStatus(await api('PATCH', `/api/leave-requests/${own.id}`, { as: own.who, body: { action } }), 403);
      }
      assert.equal((await byId('leave_requests', own.id))?.status, 'pending_manager');
      const o = await seedLeave('pending_manager', 'owner');
      expectStatus(await api('PATCH', `/api/leave-requests/${o.id}`, { as: o.who, body: { action: 'approve' } }), 200);
      assert.equal((await byId('leave_requests', o.id))?.status, 'approved');
    });

    test('bad action, unknown id, other cafe', async () => {
      const { id } = await seedLeave('pending_manager');
      expectStatus(await api('PATCH', `/api/leave-requests/${id}`, { as: env.people.owner, body: { action: 'maybe' } }), 400);
      expectStatus(await api('PATCH', `/api/leave-requests/00000000-0000-4000-8000-000000000000`, { as: env.people.owner, body: { action: 'approve' } }), 404);
      expectStatus(await api('PATCH', `/api/leave-requests/${id}`, { as: env.people.owner2, body: { action: 'approve' } }), 404);
    });
  });

  describe('leave: cancel and delete', () => {
    for (const from of STATUSES) {
      ['requester', 'staff', 'manager', 'owner'].forEach((actor, i) => {
        const http = DELETE[from][i];
        test(`delete ${from} as ${actor} -> ${http}`, async () => {
          const { id, who } = await seedLeave(from);
          const by = actor === 'requester' ? who : env.people[actor as 'staff' | 'manager' | 'owner'];
          const before = await annual(who.id);
          expectStatus(await api('DELETE', `/api/leave-requests/${id}`, { as: by }), http);
          const gone = (await byId('leave_requests', id)) === undefined;
          assert.equal(gone, http === 200);
          // pending and approved requests hold days, so deleting one gives them back; a rejected one already did
          const refund = http === 200 && from !== 'rejected' ? DAYS : 0;
          assert.equal(await annual(who.id), before + refund);
        });
      });
    }

    test('unknown id is 404 and another cafe sees 404', async () => {
      const { id } = await seedLeave('pending_manager');
      expectStatus(await api('DELETE', `/api/leave-requests/00000000-0000-4000-8000-000000000000`, { as: env.people.owner }), 404);
      expectStatus(await api('DELETE', `/api/leave-requests/${id}`, { as: env.people.owner2 }), 404);
    });
  });
}
