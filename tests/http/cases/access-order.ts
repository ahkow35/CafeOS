/**
 * Which reply a tenant route gives when several access facts are off at the same moment
 * (the per-request check in requireTenantUser). The person signs in first, then the rows are
 * changed by SQL; each case puts the rows back afterwards.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, newCafe, newMember, row } from '../harness';
import { refuse } from './util';

type Flip = 'profile_inactive' | 'stale_session' | 'access_off' | 'membership_not_active' | 'cafe_suspended' | 'cafe_pending';

const APPLY: Record<Flip, string> = {
  profile_inactive: `UPDATE profiles SET is_active = FALSE WHERE id = $1`,
  stale_session: `UPDATE profiles SET token_version = token_version + 1 WHERE id = $1`,
  access_off: `UPDATE cafe_memberships SET employment_active = FALSE WHERE user_id = $1`,
  membership_not_active: `UPDATE cafe_memberships SET status = 'suspended' WHERE user_id = $1`,
  cafe_suspended: `UPDATE cafes SET status = 'suspended' WHERE id = (SELECT cafe_id FROM cafe_memberships WHERE user_id = $1)`,
  cafe_pending: `UPDATE cafes SET status = 'pending' WHERE id = (SELECT cafe_id FROM cafe_memberships WHERE user_id = $1)`,
};

const RESTORE: Record<Flip, string> = {
  profile_inactive: `UPDATE profiles SET is_active = TRUE WHERE id = $1`,
  stale_session: `UPDATE profiles SET token_version = token_version - 1 WHERE id = $1`,
  access_off: `UPDATE cafe_memberships SET employment_active = TRUE WHERE user_id = $1`,
  membership_not_active: `UPDATE cafe_memberships SET status = 'active' WHERE user_id = $1`,
  cafe_suspended: `UPDATE cafes SET status = 'active' WHERE id = (SELECT cafe_id FROM cafe_memberships WHERE user_id = $1)`,
  cafe_pending: `UPDATE cafes SET status = 'active' WHERE id = (SELECT cafe_id FROM cafe_memberships WHERE user_id = $1)`,
};

const CASES: Array<{ flips: Flip[]; status: number; error: string }> = [
  { flips: ['profile_inactive', 'access_off'], status: 403, error: 'This account is disabled. Contact your manager.' },
  { flips: ['profile_inactive', 'stale_session'], status: 403, error: 'This account is disabled. Contact your manager.' },
  { flips: ['stale_session', 'access_off'], status: 401, error: 'Your session has expired. Please sign in again.' },
  { flips: ['access_off', 'cafe_suspended'], status: 403, error: 'Your access to this cafe has been disabled' },
  { flips: ['membership_not_active', 'profile_inactive'], status: 403, error: 'Your membership in this cafe is no longer active' },
  { flips: ['cafe_suspended'], status: 403, error: 'This cafe has been suspended' },
  { flips: ['cafe_pending'], status: 403, error: 'This cafe is pending approval' },
  { flips: ['stale_session', 'cafe_suspended'], status: 401, error: 'Your session has expired. Please sign in again.' },
  { flips: ['access_off', 'cafe_pending'], status: 403, error: 'Your access to this cafe has been disabled' },
  { flips: ['membership_not_active', 'access_off', 'stale_session', 'profile_inactive', 'cafe_suspended'], status: 403, error: 'Your membership in this cafe is no longer active' },
];

export function accessOrderCases(): void {
  describe('access order: several facts off at once', () => {
    for (const c of CASES) {
      const name = c.flips.join(' + ');
      test(`${name}`, async () => {
        const cafeId = await newCafe('active');
        const m = await newMember('staff', cafeId);
        await api('GET', '/api/tasks', { as: m }); // signs in with everything on
        try {
          for (const f of c.flips) await row(APPLY[f], [m.id]);
          const r = await api('GET', '/api/tasks', { as: m });
          refuse(`access order | ${name} | GET tasks | by staff`, r, c.status);
          assert.equal(r.json.error, c.error);
        } finally {
          for (const f of [...c.flips].reverse()) await row(RESTORE[f], [m.id]);
        }
        const back = await api('GET', '/api/tasks', { as: m });
        assert.equal(back.status, 200, `rows should be back to normal: ${JSON.stringify(back.json)}`);
      });
    }
  });
}
