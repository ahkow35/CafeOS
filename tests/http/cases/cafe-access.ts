/**
 * One cafe-access rule: a person whose access to a cafe is switched off is treated the same
 * everywhere (cafe picker, cafe switch, view-as, task assignee).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { addMembership, api, env, newMember, PIN, row, type Person, type Reply } from '../harness';
import { expectStatus } from './util';

const cookieOf = (r: Reply, name: string): string => {
  for (const c of r.headers.getSetCookie()) {
    const m = new RegExp(`^(${name}=[^;]+)`).exec(c);
    if (m) return m[1];
  }
  return '';
};

const DEADLINE = '3030-01-01T00:00:00.000Z';

/** Someone with a seat in both fixture cafes, signed in at the picker. Returns the picker cookie. */
async function memberOfTwoCafes(): Promise<{ person: Person; pick: string }> {
  const person = await newMember('staff', env.cafe1);
  await addMembership(person.id, env.cafe2, 'staff');
  const login = await api('POST', '/api/auth/login', { body: { phone: person.phone, pin: PIN } });
  expectStatus(login, 200);
  const pick = cookieOf(login, 'cafeos_pick');
  assert.ok(pick);
  return { person, pick };
}

const switchOff = (userId: string, cafeId: string) =>
  row(`UPDATE cafe_memberships SET employment_active = FALSE WHERE user_id = $1 AND cafe_id = $2`, [userId, cafeId]);

export function cafeAccessCases(): void {
  describe('cafe access: picking a cafe', () => {
    test('a cafe the person still has access to can be picked', async () => {
      const { pick } = await memberOfTwoCafes();
      expectStatus(await api('POST', '/api/auth/select-cafe', { cookie: pick, body: { cafeId: env.cafe2 } }), 200);
    });

    test('a cafe where access is switched off gets the same reply as a cafe the person is not in', async () => {
      const { person, pick } = await memberOfTwoCafes();
      await switchOff(person.id, env.cafe2);
      const notMine = await api('POST', '/api/auth/select-cafe', { cookie: pick, body: { cafeId: env.pendingCafe } });
      const off = await api('POST', '/api/auth/select-cafe', { cookie: pick, body: { cafeId: env.cafe2 } });
      expectStatus(off, 403);
      assert.deepEqual(off.json, { error: 'No active membership in this cafe', code: 'no_membership' });
      assert.deepEqual(off.json, notMine.json);
      assert.equal(cookieOf(off, 'cafeos_session'), '');
    });

    test('the other cafe can still be picked', async () => {
      const { person, pick } = await memberOfTwoCafes();
      await switchOff(person.id, env.cafe2);
      expectStatus(await api('POST', '/api/auth/select-cafe', { cookie: pick, body: { cafeId: env.cafe1 } }), 200);
    });
  });

  describe('cafe access: switching cafe', () => {
    async function signedIn(): Promise<{ person: Person; session: string }> {
      const { person, pick } = await memberOfTwoCafes();
      const sel = await api('POST', '/api/auth/select-cafe', { cookie: pick, body: { cafeId: env.cafe1 } });
      expectStatus(sel, 200);
      return { person, session: cookieOf(sel, 'cafeos_session') };
    }

    test('a cafe the person still has access to can be switched to', async () => {
      const { session } = await signedIn();
      expectStatus(await api('POST', '/api/auth/switch-cafe', { cookie: session, body: { cafeId: env.cafe2 } }), 200);
    });

    test('a cafe where access is switched off gets the same reply as a cafe the person is not in', async () => {
      const { person, session } = await signedIn();
      await switchOff(person.id, env.cafe2);
      const notMine = await api('POST', '/api/auth/switch-cafe', { cookie: session, body: { cafeId: env.pendingCafe } });
      const off = await api('POST', '/api/auth/switch-cafe', { cookie: session, body: { cafeId: env.cafe2 } });
      expectStatus(off, 403);
      assert.deepEqual(off.json, { error: 'No active membership in this cafe', code: 'no_membership' });
      assert.deepEqual(off.json, notMine.json);
      assert.equal(cookieOf(off, 'cafeos_session'), '');
    });
  });

  describe('cafe access: view-as', () => {
    const viewAs = (cafeId: string, userId: string) =>
      api('POST', `/api/super/cafes/${cafeId}/impersonate`, { as: env.people.super, body: { userId } });

    test('a person with access can be viewed as', async () => {
      const m = await newMember('staff');
      expectStatus(await viewAs(env.cafe1, m.id), 200);
    });

    test('a person whose access is switched off gets the no-membership reply', async () => {
      const m = await newMember('staff', env.cafe1, { employmentActive: false });
      const r = await viewAs(env.cafe1, m.id);
      expectStatus(r, 404);
      assert.deepEqual(r.json, { error: 'User has no active membership in this cafe' });
      assert.equal(cookieOf(r, 'cafeos_session'), '');
    });
  });

  describe('cafe access: task assignee', () => {
    const create = (assignedTo: string) =>
      api('POST', '/api/tasks', { as: env.people.manager, body: { title: 'Wipe the machine', deadline: DEADLINE, assigned_to: assignedTo } });
    const reassign = async (assignedTo: string) => {
      const made = await create('all');
      expectStatus(made, 201);
      return api('PATCH', `/api/tasks/${made.json.task.id}`, { as: env.people.manager, body: { assigned_to: assignedTo } });
    };

    test('a person with access can be assigned a task, on create and on edit', async () => {
      const m = await newMember('staff');
      expectStatus(await create(m.id), 201);
      expectStatus(await reassign(m.id), 200);
    });

    test('a person whose access is switched off gets the inactive-assignee reply, same as an inactive profile', async () => {
      const off = await newMember('staff', env.cafe1, { employmentActive: false });
      const inactiveProfile = await newMember('staff');
      await row(`UPDATE profiles SET is_active = FALSE WHERE id = $1`, [inactiveProfile.id]);

      for (const go of [create, reassign]) {
        const expected = await go(inactiveProfile.id);
        assert.equal(expected.json.error, 'Assignee is inactive');
        const r = await go(off.id);
        assert.equal(r.status, expected.status);
        assert.deepEqual(r.json, expected.json);
      }
    });

    test('the other assignee replies are unchanged and in the same order', async () => {
      const outsider = await newMember('staff', env.cafe2);
      const unknown = '00000000-0000-4000-8000-000000000000';
      for (const go of [create, reassign]) {
        assert.equal((await go(unknown)).json.error, 'Assignee does not exist');
        assert.equal((await go(outsider.id)).json.error, 'Assignee is not a member of this cafe');
      }
    });
  });
}
