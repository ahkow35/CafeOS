import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideOwnerCredential } from '../src/lib/cafeApproval';

// Case (a): a brand-new /api/start signup — placeholder PIN, never active.
test('a profile that has never had a real PIN and is inactive gets a fresh PIN', () => {
  assert.deepEqual(decideOwnerCredential({ isActive: false, pinSetAt: null }), { action: 'issue_pin' });
});

// Case (b): the phone number already belongs to a working account elsewhere —
// approval must never overwrite or reissue their credential.
test('an existing ACTIVE profile keeps its PIN', () => {
  const result = decideOwnerCredential({ isActive: true, pinSetAt: '2026-08-01T00:00:00Z' });
  assert.deepEqual(result, { action: 'keep_pin' });
});

// Case (c): the phone belongs to an existing but currently inactive account —
// ambiguous (deactivated on purpose, or a stale row) — a super admin decides.
test('an existing INACTIVE profile is refused, not silently reactivated', () => {
  const result = decideOwnerCredential({ isActive: false, pinSetAt: '2026-08-01T00:00:00Z' });
  assert.equal(result.action, 'refuse');
  if (result.action === 'refuse') {
    assert.match(result.reason, /inactive/i);
  }
});

// Defensive: an active profile always keeps its PIN even if pin_set_at is
// somehow unset (should not happen post-migration, but active must win).
test('an active profile with no pin_set_at still keeps its PIN rather than being reissued one', () => {
  assert.deepEqual(decideOwnerCredential({ isActive: true, pinSetAt: null }), { action: 'keep_pin' });
});
