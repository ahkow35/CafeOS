/** Change PIN: a right current PIN clears the attempt count even when the request is then refused. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, newMember, row, PIN } from '../harness';
import { expectStatus } from './util';

export function signInAttemptResetCases(): void {
  describe('sign-in attempts: change PIN, right current PIN then refused', () => {
    test('the count is back to 0 when the new PIN equals the current one', async () => {
      const m = await newMember('staff');
      await m.cookie();
      for (let i = 0; i < 3; i++) {
        expectStatus(await api('POST', '/api/auth/change-pin', { as: m, body: { currentPin: '135792', newPin: '864209' } }), 400);
      }
      const r = await api('POST', '/api/auth/change-pin', { as: m, body: { currentPin: PIN, newPin: PIN } });
      expectStatus(r, 400);
      assert.deepEqual(r.json, { error: 'Choose a PIN that is different from your current PIN' });
      const c = await row<{ failed_attempts: number; locked_until: Date | null }>(
        `SELECT failed_attempts, locked_until FROM profiles WHERE id = $1`, [m.id]);
      assert.deepEqual([c?.failed_attempts, c?.locked_until], [0, null]);
    });
  });
}
