/** Medical claims: the owner's approve/reject, cancel and delete, and the balance after each. Rows are inserted by SQL (no receipt upload). */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { api, env, newMember, row, type Person, type Role } from '../harness';
import { byId, expectStatus, refuse, stampIs } from './util';

type Status = 'pending' | 'approved' | 'rejected';
const STATUSES: Status[] = ['pending', 'approved', 'rejected'];
const CLAIMED = 30;
const START_BALANCE = 100;
const RECEIPT = 'https://example.invalid/claim-receipts/none.pdf'; // never fetched; deleting it fails harmlessly with no storage token

const balance = async (userId: string): Promise<number> =>
  Number((await row(`SELECT medical_claim_balance AS b FROM cafe_memberships WHERE user_id = $1 AND cafe_id = $2`, [userId, env.cafe1]))!.b);

/** A claim in the given status for a fresh claimant; an approved claim has already taken its amount off the balance. */
async function seedClaim(status: Status, role: Role = 'staff', bal = START_BALANCE): Promise<{ id: string; who: Person }> {
  const who = await newMember(role);
  await row(`UPDATE cafe_memberships SET medical_claim_balance = $1 WHERE user_id = $2 AND cafe_id = $3`,
    [status === 'approved' ? bal - CLAIMED : bal, who.id, env.cafe1]);
  const decided = status !== 'pending';
  const r = await row<{ id: string }>(
    `INSERT INTO medical_claims (cafe_id, user_id, receipt_date, amount_claimed, receipt_url, status,
                                 amount_approved, decided_by, decided_at, decision_note)
     VALUES ($1, $2, '2030-01-15', $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [env.cafe1, who.id, CLAIMED, RECEIPT, status, status === 'approved' ? CLAIMED : null,
      decided ? env.people.owner.id : null, decided ? new Date() : null, status === 'rejected' ? 'seed note' : null],
  );
  return { id: r!.id, who };
}

const patch = (id: string, as: Person, body: unknown) => api('PATCH', `/api/claims/${id}`, { as, body });

export function claimCases(): void {
  describe('claims: approve and reject', () => {
    test('approve in full: stamps, amount and balance', async () => {
      const { id, who } = await seedClaim('pending');
      const r = await patch(id, env.people.owner, { action: 'approve' });
      expectStatus(r, 200);
      const c = await byId('medical_claims', id);
      assert.deepEqual([c?.status, Number(c?.amount_approved), c?.decision_note], ['approved', CLAIMED, null]);
      stampIs(c, 'decided_by', env.people.owner.id);
      assert.ok(c?.decided_at);
      assert.deepEqual([r.json.claim.status, r.json.claim.amount_approved, r.json.claim.receipt_url], ['approved', CLAIMED, `/api/claims/${id}/receipt`]);
      assert.equal(await balance(who.id), START_BALANCE - CLAIMED);
    });

    test('approve at a lower amount deducts only that amount', async () => {
      const { id, who } = await seedClaim('pending');
      expectStatus(await patch(id, env.people.owner, { action: 'approve', amount_approved: '20.50' }), 200);
      assert.equal(Number((await byId('medical_claims', id))?.amount_approved), 20.5);
      assert.equal(await balance(who.id), START_BALANCE - 20.5);
    });

    test('approve above the claimed amount, above the balance, or with a bad amount is refused', async () => {
      const { id, who } = await seedClaim('pending');
      for (const amount_approved of [31, 'abc', 0, -1]) {
        refuse(`claim PATCH approve | amount_approved ${JSON.stringify(amount_approved)} | by owner`, await patch(id, env.people.owner, { action: 'approve', amount_approved }), 400);
      }
      const low = await seedClaim('pending', 'staff', 10);
      refuse('claim PATCH approve | claimed amount above the balance | by owner', await patch(low.id, env.people.owner, { action: 'approve' }), 400);
      assert.equal((await byId('medical_claims', low.id))?.status, 'pending');
      assert.equal(await balance(low.who.id), 10);
      assert.equal(await balance(who.id), START_BALANCE);
    });

    test('reject with a note: stamps and no balance change', async () => {
      const { id, who } = await seedClaim('pending');
      expectStatus(await patch(id, env.people.owner, { action: 'reject', note: '  not covered  ' }), 200);
      const c = await byId('medical_claims', id);
      assert.deepEqual([c?.status, c?.amount_approved, c?.decision_note], ['rejected', null, 'not covered']);
      stampIs(c, 'decided_by', env.people.owner.id);
      assert.equal(await balance(who.id), START_BALANCE);
    });

    test('reject without a note stores none; a long or non-text note is refused', async () => {
      const a = await seedClaim('pending');
      expectStatus(await patch(a.id, env.people.owner, { action: 'reject' }), 200);
      assert.equal((await byId('medical_claims', a.id))?.decision_note, null);
      const b = await seedClaim('pending');
      refuse('claim PATCH reject | note of 501 characters | by owner', await patch(b.id, env.people.owner, { action: 'reject', note: 'x'.repeat(501) }), 400);
      refuse('claim PATCH reject | note that is not text | by owner', await patch(b.id, env.people.owner, { action: 'reject', note: 5 }), 400);
      assert.equal((await byId('medical_claims', b.id))?.status, 'pending');
    });

    for (const from of ['approved', 'rejected'] as const) {
      for (const action of ['approve', 'reject']) {
        test(`${action} an already ${from} claim -> 409`, async () => {
          const { id, who } = await seedClaim(from);
          const before = await balance(who.id);
          refuse(`claim PATCH ${action} | from ${from} | by owner`, await patch(id, env.people.owner, { action }), 409);
          assert.equal((await byId('medical_claims', id))?.status, from);
          assert.equal(await balance(who.id), before);
        });
      }
    }

    test('only the owner decides: manager, claimant and other staff get 403', async () => {
      const { id, who } = await seedClaim('pending');
      for (const [name, by] of [['mgr', env.people.manager], ['claimant', who], ['staff', env.people.staff]] as const) {
        refuse(`claim PATCH approve | from pending | by ${name}`, await patch(id, by, { action: 'approve' }), 403);
      }
      assert.equal((await byId('medical_claims', id))?.status, 'pending');
    });

    test('bad action, unknown id, other cafe', async () => {
      const { id } = await seedClaim('pending');
      refuse('claim PATCH | unknown action | by owner', await patch(id, env.people.owner, { action: 'maybe' }), 400);
      refuse('claim PATCH | unknown id | by owner', await patch('00000000-0000-4000-8000-000000000000', env.people.owner, { action: 'approve' }), 404);
      refuse('claim PATCH | other cafe | by owner2', await patch(id, env.people.owner2, { action: 'approve' }), 404);
    });
  });

  describe('claims: cancel and delete', () => {
    // [claimant, other staff, manager, owner]
    const TABLE: Record<Status, number[]> = { pending: [200, 403, 403, 200], approved: [403, 403, 403, 200], rejected: [403, 403, 403, 200] };
    for (const from of STATUSES) {
      ['claimant', 'staff', 'manager', 'owner'].forEach((actor, i) => {
        const http = TABLE[from][i];
        test(`delete ${from} as ${actor} -> ${http}`, async () => {
          const { id, who } = await seedClaim(from);
          const by = actor === 'claimant' ? who : env.people[actor as 'staff' | 'manager' | 'owner'];
          const before = await balance(who.id);
          const r = await api('DELETE', `/api/claims/${id}`, { as: by });
          if (http === 200) expectStatus(r, http);
          else refuse(`claim DELETE | from ${from} | by ${actor}`, r, http);
          assert.equal((await byId('medical_claims', id)) === undefined, http === 200);
          // only purging an approved claim gives its amount back
          assert.equal(await balance(who.id), before + (http === 200 && from === 'approved' ? CLAIMED : 0));
        });
      });
    }

    test('a manager can cancel their own pending claim', async () => {
      const { id, who } = await seedClaim('pending', 'manager');
      expectStatus(await api('DELETE', `/api/claims/${id}`, { as: who }), 200);
      assert.equal(await byId('medical_claims', id), undefined);
    });

    test('unknown id 404, other cafe 404', async () => {
      const { id } = await seedClaim('pending');
      refuse('claim DELETE | unknown id | by owner', await api('DELETE', `/api/claims/00000000-0000-4000-8000-000000000000`, { as: env.people.owner }), 404);
      refuse('claim DELETE | other cafe | by owner2', await api('DELETE', `/api/claims/${id}`, { as: env.people.owner2 }), 404);
    });
  });

  describe('claims: lists and submit refusals', () => {
    test('mine, pending (manager and owner only)', async () => {
      const { id, who } = await seedClaim('pending');
      const mine = await api('GET', '/api/claims?scope=mine', { as: who });
      assert.deepEqual(mine.json.claims.map((c: { id: string }) => c.id), [id]);
      refuse('claim GET list | scope pending | by staff', await api('GET', '/api/claims?scope=pending', { as: env.people.staff }), 403);
      for (const by of [env.people.manager, env.people.owner]) {
        const r = await api('GET', '/api/claims?scope=pending', { as: by });
        assert.ok(r.json.claims.some((c: { id: string }) => c.id === id));
      }
      refuse('claim GET list | unknown scope | by staff', await api('GET', '/api/claims?scope=bogus', { as: who }), 400);
    });

    test('submitting needs a receipt URL that belongs to the caller', async () => {
      const who = await newMember('staff');
      const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
      const body = { receipt_date: twoDaysAgo, amount_claimed: 10 };
      refuse('claim POST | no receipt URL | by staff', await api('POST', '/api/claims', { as: who, body }), 400);
      refuse('claim POST | receipt URL not belonging to the caller | by staff', await api('POST', '/api/claims', { as: who, body: { ...body, receipt_url: RECEIPT } }), 400);
      refuse('claim POST | signed out', await api('POST', '/api/claims', { body }), 401);
      assert.equal((await row(`SELECT count(*)::int AS n FROM medical_claims WHERE user_id = $1`, [who.id]))?.n, 0);
    });
  });
}
