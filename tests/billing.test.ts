import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cafeStatusFromStripe, resolveBillingStatus } from '../src/lib/billing';

test('cafeStatusFromStripe maps active-ish statuses to active', () => {
  assert.equal(cafeStatusFromStripe('trialing'), 'active');
  assert.equal(cafeStatusFromStripe('active'), 'active');
  assert.equal(cafeStatusFromStripe('past_due'), 'active');
});

test('cafeStatusFromStripe maps terminal statuses to suspended', () => {
  assert.equal(cafeStatusFromStripe('canceled'), 'suspended');
  assert.equal(cafeStatusFromStripe('unpaid'), 'suspended');
  assert.equal(cafeStatusFromStripe('paused'), 'suspended');
  assert.equal(cafeStatusFromStripe('incomplete_expired'), 'suspended');
});

test('cafeStatusFromStripe returns null for statuses it does not classify', () => {
  assert.equal(cafeStatusFromStripe('incomplete'), null);
});

// Bug 1: an administrative suspension must never be undone by a billing event.
test('resolveBillingStatus never lifts an admin suspension', () => {
  const cafe = { status: 'suspended' as const, adminSuspendedAt: '2026-09-20T00:00:00Z' };
  assert.equal(resolveBillingStatus(cafe, 'active'), null);
  assert.equal(resolveBillingStatus(cafe, 'trialing'), null);
  assert.equal(resolveBillingStatus(cafe, 'canceled'), null);
});

test('resolveBillingStatus never activates a pending cafe', () => {
  const cafe = { status: 'pending' as const, adminSuspendedAt: null };
  assert.equal(resolveBillingStatus(cafe, 'active'), null);
  assert.equal(resolveBillingStatus(cafe, 'trialing'), null);
});

test('resolveBillingStatus lets billing suspend an active cafe that is not admin-suspended', () => {
  const cafe = { status: 'active' as const, adminSuspendedAt: null };
  assert.equal(resolveBillingStatus(cafe, 'canceled'), 'suspended');
});

// The designed onboarding flow: trial ends with no card -> Stripe pauses the
// subscription -> cafe suspended by billing (not an admin) -> owner adds a
// card -> the SAME subscription resumes 'active'. Billing must be able to
// recover its own suspension automatically.
test('resolveBillingStatus lets billing recover its own (non-admin) suspension', () => {
  const cafe = { status: 'suspended' as const, adminSuspendedAt: null };
  assert.equal(resolveBillingStatus(cafe, 'active'), 'active');
});

test('resolveBillingStatus is a no-op (returns null) for statuses cafeStatusFromStripe does not classify', () => {
  const cafe = { status: 'active' as const, adminSuspendedAt: null };
  assert.equal(resolveBillingStatus(cafe, 'incomplete'), null);
});
