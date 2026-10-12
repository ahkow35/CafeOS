import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideContactAcceptance,
  decideSignupEligibility,
  digitsOnly,
  generateSignupToken,
  hashSignupToken,
  type ContactAcceptanceInput,
} from '../src/lib/instantSignup';

// ─── token shape ─────────────────────────────────────────────────────────────

test('generateSignupToken produces a 43-char base64url string (32 random bytes)', () => {
  const token = generateSignupToken();
  assert.equal(token.length, 43);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(token, generateSignupToken(), 'two calls must not collide');
});

test('hashSignupToken is deterministic and hex-encoded', () => {
  const token = generateSignupToken();
  assert.equal(hashSignupToken(token), hashSignupToken(token));
  assert.match(hashSignupToken(token), /^[0-9a-f]{64}$/);
});

test('/start payload budget: token fits Telegram\'s 64-char /start argument', () => {
  const token = generateSignupToken();
  assert.ok(token.length <= 64);
});

// ─── digitsOnly / phone matching ─────────────────────────────────────────────

test('digitsOnly strips everything but digits', () => {
  assert.equal(digitsOnly('+65 9123 4567'), '6591234567');
  assert.equal(digitsOnly('91234567'), '91234567');
  assert.equal(digitsOnly(''), '');
});

// ─── decideSignupEligibility ──────────────────────────────────────────────────

test('eligibility: an existing profile for the phone refuses', () => {
  const result = decideSignupEligibility({ phoneHasProfile: true, hasOtherOpenOrCompletedSignup: false });
  assert.deepEqual(result, { eligible: false, reason: 'existing_profile' });
});

test('eligibility: another open/completed signup for the phone refuses', () => {
  const result = decideSignupEligibility({ phoneHasProfile: false, hasOtherOpenOrCompletedSignup: true });
  assert.deepEqual(result, { eligible: false, reason: 'signup_in_progress' });
});

test('eligibility: existing profile wins over an in-progress signup when both are true', () => {
  const result = decideSignupEligibility({ phoneHasProfile: true, hasOtherOpenOrCompletedSignup: true });
  assert.deepEqual(result, { eligible: false, reason: 'existing_profile' });
});

test('eligibility: a brand-new number with no other signup is eligible', () => {
  assert.deepEqual(
    decideSignupEligibility({ phoneHasProfile: false, hasOtherOpenOrCompletedSignup: false }),
    { eligible: true },
  );
});

// ─── decideContactAcceptance ──────────────────────────────────────────────────

function baseInput(overrides: Partial<ContactAcceptanceInput> = {}): ContactAcceptanceInput {
  return {
    isPrivateChat: true,
    contactUserId: 111,
    fromId: 111,
    contactPhone: '+6591234567',
    signupPhoneE164: '+6591234567',
    hasEligibleSignupForUser: true,
    telegramAlreadyLinkedToProfile: false,
    phoneHasProfile: false,
    ...overrides,
  };
}

test('contact acceptance: the happy path is accepted', () => {
  assert.deepEqual(decideContactAcceptance(baseInput()), { accepted: true });
});

test('contact acceptance: group chat is rejected even with a matching contact', () => {
  const result = decideContactAcceptance(baseInput({ isPrivateChat: false }));
  assert.deepEqual(result, { accepted: false, reason: 'not_private' });
});

test('contact acceptance: no verified/provisioned signup for this Telegram user is rejected', () => {
  const result = decideContactAcceptance(baseInput({ hasEligibleSignupForUser: false }));
  assert.deepEqual(result, { accepted: false, reason: 'no_eligible_signup' });
});

test('contact acceptance: a forwarded contact (user_id belongs to someone else) is rejected', () => {
  const result = decideContactAcceptance(baseInput({ contactUserId: 222 }));
  assert.deepEqual(result, { accepted: false, reason: 'contact_user_id_mismatch' });
});

test('contact acceptance: a contact with no user_id at all is rejected', () => {
  const result = decideContactAcceptance(baseInput({ contactUserId: undefined }));
  assert.deepEqual(result, { accepted: false, reason: 'contact_user_id_mismatch' });
});

test('contact acceptance: phone digits must match (formatting differences ignored)', () => {
  const matches = decideContactAcceptance(baseInput({ contactPhone: '6591234567', signupPhoneE164: '+65 9123 4567' }));
  assert.deepEqual(matches, { accepted: true });

  const mismatches = decideContactAcceptance(baseInput({ contactPhone: '+6598765432' }));
  assert.deepEqual(mismatches, { accepted: false, reason: 'phone_mismatch' });
});

test('contact acceptance: a Telegram account already linked to another profile is rejected', () => {
  const result = decideContactAcceptance(baseInput({ telegramAlreadyLinkedToProfile: true }));
  assert.deepEqual(result, { accepted: false, reason: 'telegram_already_linked' });
});

test('contact acceptance: a phone that now has a profile (re-checked at contact time) is rejected', () => {
  const result = decideContactAcceptance(baseInput({ phoneHasProfile: true }));
  assert.deepEqual(result, { accepted: false, reason: 'phone_now_has_profile' });
});

test('contact acceptance checks run in a fixed order: not_private beats every other failure', () => {
  const result = decideContactAcceptance(
    baseInput({ isPrivateChat: false, hasEligibleSignupForUser: false, contactUserId: 222, phoneHasProfile: true }),
  );
  assert.deepEqual(result, { accepted: false, reason: 'not_private' });
});
