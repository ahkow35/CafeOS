/** Who is let in at all: signed out, the other cafe, employment switched off, the cafe picker, super admin. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { api, env, newMember, row, PIN, type Reply } from '../harness';
import { byId, expectStatus } from './util';
import { signInAttemptResetCases } from './sign-in-attempts-reset';

const cookieOf = (r: Reply, name: string): string => {
  for (const c of r.headers.getSetCookie()) {
    const m = new RegExp(`^(${name}=[^;]+)`).exec(c);
    if (m) return m[1];
  }
  return '';
};

export function accessCases(): void {
  signInAttemptResetCases();
  describe('access: signed out', () => {
    for (const [method, path] of [
      ['GET', '/api/timesheets'], ['POST', '/api/timesheets'], ['GET', '/api/leave-requests'], ['GET', '/api/claims'],
      ['GET', '/api/tasks'], ['PATCH', '/api/tasks/00000000-0000-4000-8000-000000000000'],
    ]) {
      test(`${method} ${path} -> 401`, async () => {
        expectStatus(await api(method, path, { body: method === 'GET' ? undefined : {} }), 401);
      });
    }

    test('the who-am-I route answers 200 with no user rather than 401', async () => {
      const r = await api('GET', '/api/auth/me');
      assert.deepEqual([r.status, r.json], [200, { user: null }]);
    });

    test('super routes are 401 signed out and 403 for a cafe owner', async () => {
      expectStatus(await api('GET', '/api/super/cafes'), 401);
      expectStatus(await api('GET', '/api/super/cafes', { as: env.people.owner }), 403);
      expectStatus(await api('GET', '/api/super/cafes', { as: env.people.super }), 200);
    });
  });

  describe('access: other cafe and switched-off members', () => {
    test('a member of the other cafe is served only their own cafe', async () => {
      const mine = await api('GET', '/api/timesheets?scope=all', { as: env.people.owner2 });
      expectStatus(mine, 200);
      assert.deepEqual(mine.json.timesheets, []);
      const stranger = await newMember('part_timer');
      const made = await api('POST', '/api/timesheets', { as: stranger, body: { month_year: '3999-12' } });
      assert.equal((await byId('timesheets', made.json.timesheet.id))?.cafe_id, env.cafe1);
      expectStatus(await api('GET', `/api/timesheets/${made.json.timesheet.id}`, { as: env.people.owner2 }), 404);
    });

    test('a member whose employment is switched off cannot sign in', async () => {
      const r = await api('POST', '/api/auth/login', { body: { phone: env.people.inactive.phone, pin: PIN } });
      expectStatus(r, 403);
      assert.equal(r.json.code, 'no_active_membership');
    });

    test('switching employment off after sign-in refuses the next request', async () => {
      const m = await newMember('staff');
      expectStatus(await api('GET', '/api/tasks', { as: m }), 200);
      await row(`UPDATE cafe_memberships SET employment_active = FALSE WHERE user_id = $1`, [m.id]);
      const r = await api('GET', '/api/tasks', { as: m });
      expectStatus(r, 403);
      assert.equal(r.json.error, 'Your access to this cafe has been disabled');
    });

    test('a disabled account is refused; a bumped session counter signs the person out', async () => {
      const a = await newMember('staff');
      const b = await newMember('staff');
      await api('GET', '/api/tasks', { as: a });
      await api('GET', '/api/tasks', { as: b });
      await row(`UPDATE profiles SET is_active = FALSE WHERE id = $1`, [a.id]);
      await row(`UPDATE profiles SET token_version = token_version + 1 WHERE id = $1`, [b.id]);
      expectStatus(await api('GET', '/api/tasks', { as: a }), 403);
      expectStatus(await api('GET', '/api/tasks', { as: b }), 401);
    });
  });

  describe('access: cafe picker and super admin', () => {
    test('a member of two cafes gets a picker, then picks one', async () => {
      const login = await api('POST', '/api/auth/login', { body: { phone: env.people.multi.phone, pin: PIN } });
      expectStatus(login, 200);
      assert.equal(login.json.next, '/login/select');
      assert.equal(login.json.memberships.length, 2);
      const pick = cookieOf(login, 'cafeos_pick');
      assert.ok(pick);
      expectStatus(await api('GET', '/api/timesheets', { cookie: pick }), 401); // a picker cookie is not a session
      const sel = await api('POST', '/api/auth/select-cafe', { cookie: pick, body: { cafeId: env.cafe2 } });
      expectStatus(sel, 200);
      assert.match(sel.json.redirect, /^\/c\/http-/);
      const session = cookieOf(sel, 'cafeos_session');
      expectStatus(await api('GET', '/api/timesheets', { cookie: session }), 200);
      const made = await api('POST', '/api/timesheets', { cookie: session, body: { month_year: '3999-11' } });
      assert.equal((await byId('timesheets', made.json.timesheet.id))?.cafe_id, env.cafe2);
    });

    test('picking a cafe you are not in, with no picker cookie, or with a bad id', async () => {
      const login = await api('POST', '/api/auth/login', { body: { phone: env.people.multi.phone, pin: PIN } });
      const pick = cookieOf(login, 'cafeos_pick');
      const other = await newMember('staff');
      expectStatus(await api('POST', '/api/auth/select-cafe', { cookie: pick, body: { cafeId: env.pendingCafe } }), 403);
      expectStatus(await api('POST', '/api/auth/select-cafe', { cookie: pick, body: { cafeId: 'x' } }), 400);
      expectStatus(await api('POST', '/api/auth/select-cafe', { cookie: pick, body: { goSuper: true } }), 403);
      expectStatus(await api('POST', '/api/auth/select-cafe', { body: { cafeId: other.cafeId } }), 401);
    });

    test('a super admin with no cafe lands on /super and is refused by tenant routes', async () => {
      const login = await api('POST', '/api/auth/login', { body: { phone: env.people.super.phone, pin: PIN } });
      expectStatus(login, 200);
      assert.equal(login.json.redirect, '/super');
      expectStatus(await api('GET', '/api/timesheets', { as: env.people.super }), 403);
    });

    test('login shape: bad phone or pin format is 400', async () => {
      expectStatus(await api('POST', '/api/auth/login', { body: { phone: 'abc', pin: PIN } }), 400);
      expectStatus(await api('POST', '/api/auth/login', { body: { phone: env.people.owner.phone, pin: '12' } }), 400);
      expectStatus(await api('POST', '/api/auth/login', { raw: '{' }), 400);
    });
  });
}
