/** Cafe status: sign-up, super admin approve / reject / suspend, and what a suspended cafe's members then see. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { api, env, fakePhone, newCafeWithOwner, row, PIN, type Person } from '../harness';
import { byId, expectStatus, refuse, stampIs } from './util';

const sup = () => env.people.super;
const approve = (id: string, as: Person | null = sup()) => api('POST', `/api/super/cafes/${id}/approve`, { as });
const reject = (id: string, as: Person | null = sup()) => api('DELETE', `/api/super/cafes/${id}/reject`, { as });
const suspend = (id: string, as: Person | null = sup()) => api('POST', `/api/super/cafes/${id}/suspend`, { as });
const NOBODY = '00000000-0000-4000-8000-000000000000';

export function cafeStatusCases(): void {
  describe('cafe status: approve', () => {
    test('a pending cafe with a new owner is approved and the owner gets a working PIN', async () => {
      const { cafeId, owner } = await newCafeWithOwner('pending', { active: false, pinSet: false });
      const r = await approve(cafeId);
      expectStatus(r, 200);
      assert.match(r.json.pin, /^\d{6}$/);
      const c = await byId('cafes', cafeId);
      assert.equal(c?.status, 'active');
      stampIs(c, 'approved_by', sup().id);
      assert.ok(c?.approved_at);
      assert.equal(c?.admin_suspended_at, null);
      assert.equal((await row(`SELECT status FROM cafe_memberships WHERE cafe_id = $1`, [cafeId]))?.status, 'active');
      const p = await byId('profiles', owner.id);
      assert.deepEqual([p?.is_active, p?.token_version], [true, 1]);
      assert.ok(p?.pin_set_at);
      const signIn = await api('POST', '/api/auth/login', { body: { phone: owner.phone, pin: r.json.pin } });
      expectStatus(signIn, 200);
    });

    test('an owner who already has a working account keeps their PIN', async () => {
      const { cafeId, owner } = await newCafeWithOwner('pending', { active: true, pinSet: true });
      const before = await byId('profiles', owner.id);
      const r = await approve(cafeId);
      expectStatus(r, 200);
      assert.equal(r.json.pin, null);
      const after = await byId('profiles', owner.id);
      assert.deepEqual([after?.pin_hash, after?.token_version], [before?.pin_hash, before?.token_version]);
      assert.equal((await byId('cafes', cafeId))?.status, 'active');
      assert.equal((await row(`SELECT status FROM cafe_memberships WHERE cafe_id = $1`, [cafeId]))?.status, 'active');
    });

    test('an owner whose account is disabled blocks the approval (409, nothing changes)', async () => {
      const { cafeId } = await newCafeWithOwner('pending', { active: false, pinSet: true });
      refuse('super approve | owner account disabled | by super', await approve(cafeId), 409);
      assert.equal((await byId('cafes', cafeId))?.status, 'pending');
      assert.equal((await row(`SELECT status FROM cafe_memberships WHERE cafe_id = $1`, [cafeId]))?.status, 'pending');
    });

    for (const status of ['active', 'suspended'] as const) {
      test(`approve on a ${status} cafe -> 409`, async () => {
        const { cafeId } = await newCafeWithOwner(status);
        refuse(`super approve | from ${status} | by super`, await approve(cafeId), 409);
        assert.equal((await byId('cafes', cafeId))?.status, status);
      });
    }

    test('approving twice: the second is a 409', async () => {
      const { cafeId } = await newCafeWithOwner('pending', { active: false, pinSet: false });
      expectStatus(await approve(cafeId), 200);
      refuse('super approve | second approval of the same cafe | by super', await approve(cafeId), 409);
    });

    test('unknown id, bad id, and who may call it', async () => {
      const { cafeId } = await newCafeWithOwner('pending', { active: false, pinSet: false });
      refuse('super approve | unknown id | by super', await approve(NOBODY), 404);
      refuse('super approve | malformed id | by super', await approve('nope'), 400);
      refuse('super approve | from pending | by owner', await approve(cafeId, env.people.owner), 403);
      refuse('super approve | from pending | signed out', await approve(cafeId, null), 401);
      assert.equal((await byId('cafes', cafeId))?.status, 'pending');
    });
  });

  describe('cafe status: reject', () => {
    test('a pending cafe is deleted with its membership; the profile stays', async () => {
      const { cafeId, owner } = await newCafeWithOwner('pending', { active: false, pinSet: false });
      expectStatus(await reject(cafeId), 200);
      assert.equal(await byId('cafes', cafeId), undefined);
      assert.equal((await row(`SELECT count(*)::int AS n FROM cafe_memberships WHERE cafe_id = $1`, [cafeId]))?.n, 0);
      assert.ok(await byId('profiles', owner.id));
    });

    for (const status of ['active', 'suspended'] as const) {
      test(`reject on a ${status} cafe -> 400, cafe kept`, async () => {
        const { cafeId } = await newCafeWithOwner(status);
        refuse(`super reject | from ${status} | by super`, await reject(cafeId), 400);
        assert.equal((await byId('cafes', cafeId))?.status, status);
      });
    }

    test('unknown id, and who may call it', async () => {
      const { cafeId } = await newCafeWithOwner('pending', { active: false, pinSet: false });
      refuse('super reject | unknown id | by super', await reject(NOBODY), 404);
      refuse('super reject | from pending | by owner', await reject(cafeId, env.people.owner), 403);
      refuse('super reject | from pending | signed out', await reject(cafeId, null), 401);
      assert.equal((await byId('cafes', cafeId))?.status, 'pending');
    });
  });

  describe('cafe status: suspend', () => {
    test('an active cafe is suspended and stamped', async () => {
      const { cafeId } = await newCafeWithOwner('active');
      expectStatus(await suspend(cafeId), 200);
      const c = await byId('cafes', cafeId);
      assert.equal(c?.status, 'suspended');
      assert.ok(c?.admin_suspended_at);
    });

    test('suspend on a suspended cafe with no admin stamp -> 200, it stays suspended and is stamped', async () => {
      const { cafeId } = await newCafeWithOwner('suspended');
      assert.equal((await byId('cafes', cafeId))?.admin_suspended_at, null);
      expectStatus(await suspend(cafeId), 200);
      const c = await byId('cafes', cafeId);
      assert.equal(c?.status, 'suspended');
      assert.ok(c?.admin_suspended_at);
    });

    test('unknown id, bad id, and who may call it', async () => {
      const { cafeId } = await newCafeWithOwner('active');
      refuse('super suspend | unknown id | by super', await suspend(NOBODY), 404);
      refuse('super suspend | malformed id | by super', await suspend('nope'), 400);
      refuse('super suspend | from active | by owner', await suspend(cafeId, env.people.owner), 403);
      refuse('super suspend | from active | signed out', await suspend(cafeId, null), 401);
      assert.equal((await byId('cafes', cafeId))?.status, 'active');
    });

    test('a member already signed in is refused once the cafe is suspended, and cannot sign in again', async () => {
      const { cafeId, owner } = await newCafeWithOwner('active');
      expectStatus(await api('GET', '/api/timesheets', { as: owner }), 200);
      expectStatus(await suspend(cafeId), 200);
      const refused = await api('GET', '/api/timesheets', { as: owner });
      refuse('suspended cafe | GET timesheets | by owner already signed in', refused, 403);
      assert.equal(refused.json.error, 'This cafe has been suspended');
      const again = await api('POST', '/api/auth/login', { body: { phone: owner.phone, pin: PIN } });
      refuse('suspended cafe | sign in | by owner', again, 403);
      assert.equal(again.json.code, 'no_active_membership');
    });

    test('a member of a pending cafe cannot sign in', async () => {
      const { owner } = await newCafeWithOwner('pending', { active: true, pinSet: true });
      refuse('pending cafe | sign in | by owner', await api('POST', '/api/auth/login', { body: { phone: owner.phone, pin: PIN } }), 403);
    });
  });

  describe('cafe status: sign-up', () => {
    test('apply, apply again, a bad application, then approve the one that was made', async () => {
      const ownerPhone = fakePhone();
      const body = { cafeName: 'Sign-up Test Cafe', ownerName: 'Sign Up', ownerPhone };
      const made = await api('POST', '/api/start', { body });
      expectStatus(made, 201);
      const ids = await row<{ cafe_id: string; user_id: string }>(
        `SELECT m.cafe_id, m.user_id FROM cafe_memberships m JOIN profiles p ON p.id = m.user_id WHERE p.phone_e164 = $1`, [ownerPhone]);
      const [c, p] = [await byId('cafes', ids!.cafe_id), await byId('profiles', ids!.user_id)];
      assert.deepEqual([c?.status, p?.is_active, p?.pin_set_at], ['pending', false, null]);
      assert.equal((await row(`SELECT status FROM cafe_memberships WHERE cafe_id = $1`, [ids!.cafe_id]))?.status, 'pending');
      refuse('sign-up | same application again', await api('POST', '/api/start', { body }), 409);
      refuse('sign-up | empty cafe name', await api('POST', '/api/start', { body: { ...body, cafeName: '' } }), 400);
      const ok = await approve(ids!.cafe_id);
      expectStatus(ok, 200);
      assert.match(ok.json.pin, /^\d{6}$/);
      assert.equal((await byId('cafes', ids!.cafe_id))?.status, 'active');
    });
  });
}
