import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessVerdict, type AccessFacts, type AccessVerdict } from '../src/lib/cafeAccess';

const FULL: AccessFacts = { membershipStatus: 'active', employmentActive: true, profileActive: true, cafeStatus: 'active' };

// One row per combination that matters. Where several facts fail, the first in this order wins:
// membership, access switch, profile, cafe.
const table: Array<[string, Partial<AccessFacts>, AccessVerdict]> = [
  ['all four hold', {}, 'ok'],
  ['no membership row', { membershipStatus: null, employmentActive: null }, 'no_membership'],
  ['membership pending', { membershipStatus: 'pending' }, 'no_membership'],
  ['membership suspended', { membershipStatus: 'suspended' }, 'no_membership'],
  ['access switched off', { employmentActive: false }, 'access_off'],
  ['profile inactive', { profileActive: false }, 'profile_inactive'],
  ['cafe pending', { cafeStatus: 'pending' }, 'cafe_not_active'],
  ['cafe suspended', { cafeStatus: 'suspended' }, 'cafe_not_active'],
  ['cafe does not exist', { cafeStatus: null }, 'cafe_not_active'],
  ['access off and profile inactive', { employmentActive: false, profileActive: false }, 'access_off'],
  ['access off and cafe suspended', { employmentActive: false, cafeStatus: 'suspended' }, 'access_off'],
  ['profile inactive and cafe suspended', { profileActive: false, cafeStatus: 'suspended' }, 'profile_inactive'],
  ['suspended membership and access off', { membershipStatus: 'suspended', employmentActive: false }, 'no_membership'],
  ['everything wrong', { membershipStatus: 'suspended', employmentActive: false, profileActive: false, cafeStatus: 'suspended' }, 'no_membership'],
  ['missing access flag is not access', { employmentActive: null }, 'access_off'],
  ['missing profile flag is not access', { profileActive: null }, 'profile_inactive'],
];

for (const [name, change, expected] of table) {
  test(`accessVerdict: ${name} -> ${expected}`, () => {
    assert.equal(accessVerdict({ ...FULL, ...change }), expected);
  });
}
