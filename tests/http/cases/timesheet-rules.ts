/** Timesheet rules that sit beside the status table: create, signatures, reasons, comments, reads. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { api, env, newMember, row, nextYear } from '../harness';
import { SIG, byId, expectStatus, refuse } from './util';
import { seedSheet } from './timesheets';

const url = (id: string) => `/api/timesheets/${id}`;

export function timesheetRuleCases(): void {
  describe('timesheets: create and read', () => {
    test('create a draft, then the same month again is a 409 carrying the id', async () => {
      const pt = await newMember('part_timer');
      const month_year = `${nextYear()}-02`;
      const r = await api('POST', '/api/timesheets', { as: pt, body: { month_year } });
      expectStatus(r, 201);
      assert.equal(r.json.timesheet.status, 'draft');
      const again = await api('POST', '/api/timesheets', { as: pt, body: { month_year } });
      refuse('timesheet POST | month already exists | by pt', again, 409);
      assert.equal(again.json.id, r.json.timesheet.id);
      const stored = await byId('timesheets', r.json.timesheet.id);
      assert.deepEqual([stored?.user_id, stored?.cafe_id, stored?.status], [pt.id, env.cafe1, 'draft']);
    });

    test('create refuses a bad month and bad JSON', async () => {
      const pt = await newMember('part_timer');
      refuse('timesheet POST | bad month | by pt', await api('POST', '/api/timesheets', { as: pt, body: { month_year: '2026-13' } }), 400);
      refuse('timesheet POST | bad JSON | by pt', await api('POST', '/api/timesheets', { as: pt, raw: '{nope' }), 400);
    });

    test('a manager and an owner can each create their own', async () => {
      const m = await newMember('manager');
      expectStatus(await api('POST', '/api/timesheets', { as: m, body: { month_year: `${nextYear()}-03` } }), 201);
      const o = await newMember('owner');
      expectStatus(await api('POST', '/api/timesheets', { as: o, body: { month_year: `${nextYear()}-03` } }), 201);
    });

    test('scope=mine lists only my own; scope=all needs manager or owner', async () => {
      const { id, pt } = await seedSheet('submitted');
      const mine = await api('GET', '/api/timesheets?scope=mine', { as: pt });
      assert.deepEqual(mine.json.timesheets.map((t: { id: string }) => t.id), [id]);
      refuse('timesheet GET list | scope all | by staff', await api('GET', '/api/timesheets?scope=all', { as: env.people.staff }), 403);
      const all = await api('GET', '/api/timesheets?scope=all&status=submitted', { as: env.people.manager });
      expectStatus(all, 200);
      assert.ok(all.json.timesheets.some((t: { id: string }) => t.id === id));
      refuse('timesheet GET list | unknown scope | by pt', await api('GET', '/api/timesheets?scope=bogus', { as: pt }), 400);
      refuse('timesheet GET list | scope all with a malformed user_id | by owner', await api('GET', '/api/timesheets?scope=all&user_id=x', { as: env.people.owner }), 400);
    });

    test('reading one: the owner and a manager yes, other staff no, other cafe 404', async () => {
      const { id, pt } = await seedSheet('draft');
      expectStatus(await api('GET', url(id), { as: pt }), 200);
      expectStatus(await api('GET', url(id), { as: env.people.manager }), 200);
      refuse('timesheet GET one | other staff | by staff', await api('GET', url(id), { as: env.people.staff }), 403);
      refuse('timesheet GET one | other cafe | by owner2', await api('GET', url(id), { as: env.people.owner2 }), 404);
    });
  });

  describe('timesheets: signatures, reasons, comments', () => {
    test('submit needs an employee signature on the row or in the same request', async () => {
      const { id, pt } = await seedSheet('draft');
      await row(`UPDATE timesheets SET employee_signature = NULL WHERE id = $1`, [id]);
      refuse('timesheet PATCH submit | no signature on the row or in the request | by pt', await api('PATCH', url(id), { as: pt, body: { status: 'submitted' } }), 400);
      const r = await api('PATCH', url(id), { as: pt, body: { status: 'submitted', employee_signature: SIG } });
      expectStatus(r, 200);
      assert.equal(r.json.timesheet.status, 'submitted');
    });

    test('only the owner signs, only while draft, and it must be an image data URL', async () => {
      const { id, pt } = await seedSheet('draft');
      refuse('timesheet PATCH signature | on draft | by mgr', await api('PATCH', url(id), { as: env.people.manager, body: { employee_signature: SIG } }), 403);
      refuse('timesheet PATCH signature | not an image data URL | by pt', await api('PATCH', url(id), { as: pt, body: { employee_signature: 'hello' } }), 400);
      expectStatus(await api('PATCH', url(id), { as: pt, body: { employee_signature: SIG } }), 200);
      const sub = await seedSheet('submitted');
      refuse('timesheet PATCH signature | on submitted | by pt', await api('PATCH', url(sub.id), { as: sub.pt, body: { employee_signature: SIG } }), 400);
    });

    test('forward and approve need a manager signature; reject needs a reason', async () => {
      const a = await seedSheet('submitted');
      refuse('timesheet PATCH forward | no manager signature | by mgr', await api('PATCH', url(a.id), { as: env.people.manager, body: { status: 'pending_owner' } }), 400);
      refuse('timesheet PATCH approve | no manager signature | by owner', await api('PATCH', url(a.id), { as: env.people.owner, body: { status: 'approved' } }), 400);
      refuse('timesheet PATCH reject | no reason | by mgr', await api('PATCH', url(a.id), { as: env.people.manager, body: { status: 'rejected' } }), 400);
      assert.equal((await byId('timesheets', a.id))?.status, 'submitted');
    });

    test('a blank reason is accepted and stored as sent', async () => {
      const a = await seedSheet('submitted');
      // pins current behaviour; may change in a later PR
      expectStatus(await api('PATCH', url(a.id), { as: env.people.manager, body: { status: 'rejected', rejection_reason: '   ' } }), 200);
      assert.equal((await byId('timesheets', a.id))?.rejection_reason, '   ');
    });

    test('a manager signature already on the row is enough for the owner to approve', async () => {
      const a = await seedSheet('pending_owner');
      expectStatus(await api('PATCH', url(a.id), { as: env.people.owner, body: { status: 'approved' } }), 200);
    });

    test('rejection reason: set on reject, cleared on reopen, replaced by a later reject', async () => {
      const { id, pt } = await seedSheet('submitted');
      expectStatus(await api('PATCH', url(id), { as: env.people.manager, body: { status: 'rejected', rejection_reason: '  first  ' } }), 200);
      // pins current behaviour; may change in a later PR
      assert.equal((await byId('timesheets', id))?.rejection_reason, '  first  ');
      expectStatus(await api('PATCH', url(id), { as: pt, body: { status: 'draft' } }), 200);
      assert.equal((await byId('timesheets', id))?.rejection_reason, null);
      expectStatus(await api('PATCH', url(id), { as: pt, body: { status: 'submitted', employee_signature: SIG } }), 200);
      expectStatus(await api('PATCH', url(id), { as: env.people.owner, body: { status: 'rejected', rejection_reason: 'second' } }), 200);
      assert.equal((await byId('timesheets', id))?.rejection_reason, 'second');
    });

    test('a reason sent without a status is stored; staff cannot send one', async () => {
      const { id, pt } = await seedSheet('submitted');
      // pins current behaviour; may change in a later PR
      expectStatus(await api('PATCH', url(id), { as: env.people.manager, body: { rejection_reason: 'note' } }), 200);
      const r = await byId('timesheets', id);
      assert.deepEqual([r?.status, r?.rejection_reason], ['submitted', 'note']);
      refuse('timesheet PATCH reason without a status | by pt', await api('PATCH', url(id), { as: pt, body: { rejection_reason: 'mine' } }), 403);
    });

    test('approving keeps a reason that was on the row', async () => {
      const { id } = await seedSheet('submitted');
      await row(`UPDATE timesheets SET rejection_reason = 'older' WHERE id = $1`, [id]);
      expectStatus(await api('PATCH', url(id), { as: env.people.owner, body: { status: 'approved', manager_signature: SIG } }), 200);
      // pins current behaviour; may change in a later PR
      assert.equal((await byId('timesheets', id))?.rejection_reason, 'older');
    });

    test('comments: owner and managers may edit until approval, other staff may not', async () => {
      const { id, pt } = await seedSheet('submitted');
      expectStatus(await api('PATCH', url(id), { as: pt, body: { comments: 'mine' } }), 200);
      expectStatus(await api('PATCH', url(id), { as: env.people.manager, body: { comments: 'theirs' } }), 200);
      refuse('timesheet PATCH comments | on submitted | by staff', await api('PATCH', url(id), { as: env.people.staff, body: { comments: 'x' } }), 403);
      refuse('timesheet PATCH comments | 2001 characters | by pt', await api('PATCH', url(id), { as: pt, body: { comments: 'x'.repeat(2001) } }), 400);
      const done = await seedSheet('approved');
      refuse('timesheet PATCH comments | on approved | by owner', await api('PATCH', url(done.id), { as: env.people.owner, body: { comments: 'late' } }), 400);
    });

    test('bad status, empty body, bad id, unknown id, other cafe', async () => {
      const { id, pt } = await seedSheet('draft');
      refuse('timesheet PATCH | unknown status value | by pt', await api('PATCH', url(id), { as: pt, body: { status: 'bogus' } }), 400);
      refuse('timesheet PATCH | empty body | by pt', await api('PATCH', url(id), { as: pt, body: {} }), 400);
      refuse('timesheet PATCH | malformed id | by pt', await api('PATCH', '/api/timesheets/nope', { as: pt, body: {} }), 400);
      refuse('timesheet PATCH | unknown id | by pt', await api('PATCH', url('00000000-0000-4000-8000-000000000000'), { as: pt, body: { comments: 'x' } }), 404);
      refuse('timesheet PATCH | other cafe | by owner2', await api('PATCH', url(id), { as: env.people.owner2, body: { comments: 'x' } }), 404);
    });
  });
}
