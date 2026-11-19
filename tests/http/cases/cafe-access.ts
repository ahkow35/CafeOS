/**
 * One cafe-access rule: a person whose access to a cafe is switched off is treated the same
 * everywhere (cafe picker, cafe switch, view-as, task assignee).
 */
import { test, describe } from 'node:test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { addMembership, api, env, newCafe, newMember, PIN, row, runDatabaseUrl, type Person, type Reply } from '../harness';
import { expectStatus, refuse } from './util';

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
      refuse('cafe access | pick a cafe where access is switched off', off, 403);
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
      refuse('cafe access | switch to a cafe where access is switched off', off, 403);
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
      refuse('cafe access | view as a person whose access is switched off', r, 404);
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

      for (const [kind, go] of [['create', create], ['reassign', reassign]] as const) {
        const expected = await go(inactiveProfile.id);
        refuse(`cafe access | ${kind} task | assignee with an inactive profile`, expected, 400);
        assert.equal(expected.json.error, 'Assignee is inactive');
        const r = await go(off.id);
        assert.equal(r.status, expected.status);
        assert.deepEqual(r.json, expected.json);
      }
    });

    test('the other assignee replies are unchanged and in the same order', async () => {
      const outsider = await newMember('staff', env.cafe2);
      const unknown = '00000000-0000-4000-8000-000000000000';
      for (const [kind, go] of [['create', create], ['reassign', reassign]] as const) {
        const gone = await go(unknown);
        refuse(`cafe access | ${kind} task | assignee does not exist`, gone, gone.status);
        assert.equal(gone.json.error, 'Assignee does not exist');
        const outside = await go(outsider.id);
        refuse(`cafe access | ${kind} task | assignee in another cafe`, outside, outside.status);
        assert.equal(outside.json.error, 'Assignee is not a member of this cafe');
      }
    });
  });

  describe('cafe access: chat ids to notify', () => {
    // The library code runs in a child process against this run's database (see probe-recipients.ts).
    const listAccessChatIds = async (cafeId: string, roles: string[]): Promise<string[]> => {
      const tsx = path.resolve(__dirname, '..', '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
      const probe = path.resolve(__dirname, '..', 'probe-recipients.ts');
      const out = execFileSync(process.execPath, [tsx, probe, cafeId, roles.join(',')], {
        env: { NODE_ENV: 'development', PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '/tmp', LOCAL_PG_URL: runDatabaseUrl() },
        encoding: 'utf8', timeout: 60_000,
      });
      return JSON.parse(out) as string[];
    };
    let chatSeq = 0;
    const withChat = async (who: Person): Promise<string> => {
      chatSeq += 1;
      const chat = `990${Date.now() % 100000}${chatSeq}`;
      await row(`UPDATE profiles SET telegram_chat_id = $1 WHERE id = $2`, [chat, who.id]);
      return chat;
    };

    test('only people with access, in the asked roles, are listed', async () => {
      const cafeId = await newCafe('active');
      const owner = await newMember('owner', cafeId);
      const manager = await newMember('manager', cafeId);
      const staff = await newMember('staff', cafeId);
      const offManager = await newMember('manager', cafeId, { employmentActive: false });
      const inactiveOwner = await newMember('owner', cafeId);
      const suspendedManager = await newMember('manager', cafeId);
      await newMember('manager', cafeId); // a manager with no chat linked is never listed
      const otherCafeOwner = await newMember('owner', env.cafe2);
      await row(`UPDATE profiles SET is_active = FALSE WHERE id = $1`, [inactiveOwner.id]);
      await row(`UPDATE cafe_memberships SET status = 'suspended' WHERE user_id = $1`, [suspendedManager.id]);

      const chats = {
        owner: await withChat(owner), manager: await withChat(manager), staff: await withChat(staff),
        offManager: await withChat(offManager), inactiveOwner: await withChat(inactiveOwner),
        suspendedManager: await withChat(suspendedManager), otherCafeOwner: await withChat(otherCafeOwner),
      };

      assert.deepEqual((await listAccessChatIds(cafeId, ['manager', 'owner'])).sort(), [chats.owner, chats.manager].sort());
      assert.deepEqual(await listAccessChatIds(cafeId, ['owner']), [chats.owner]);
      assert.deepEqual(await listAccessChatIds(newCafeIdNone(), ['owner']), []);
    });

    test('the owners of a cafe that is not active are still listed', async () => {
      const cafeId = await newCafe('suspended');
      const owner = await newMember('owner', cafeId);
      const offOwner = await newMember('owner', cafeId, { employmentActive: false });
      const chat = await withChat(owner);
      await withChat(offOwner);
      assert.deepEqual(await listAccessChatIds(cafeId, ['owner']), [chat]);
    });
  });
}

function newCafeIdNone(): string { return '00000000-0000-4000-8000-000000000000'; }
