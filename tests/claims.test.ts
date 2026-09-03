import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialiseClaim, CLAIM_RETURNING, CLAIM_COLUMNS, type JoinedClaimRow } from '../src/lib/claims';

const base = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  user_id: 'u1',
  receipt_date: '2026-09-01',
  amount_claimed: '80.00',
  amount_approved: null,
  description: null,
  receipt_url: 'https://x.public.blob.vercel-storage.com/claim-receipts/c/u/1-r.jpg',
  status: 'pending' as const,
  decided_by: null,
  decided_at: null,
  decision_note: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

test('serialiseClaim converts money and gates the receipt URL', () => {
  const out = serialiseClaim(base);
  assert.equal(out.amount_claimed, 80);
  assert.equal(out.amount_approved, null);
  assert.equal(out.receipt_url, `/api/claims/${base.id}/receipt`);
  assert.equal(out.profile, undefined);
});

test('serialiseClaim attaches profile when joined columns are present', () => {
  const joined: JoinedClaimRow = {
    ...base, status: 'approved', amount_approved: '50.00',
    profile_full_name: 'Ana', profile_role: 'staff', profile_claim_balance: '250.00',
  };
  const out = serialiseClaim(joined);
  assert.equal(out.amount_approved, 50);
  assert.deepEqual(out.profile, { full_name: 'Ana', role: 'staff', medical_claim_balance: 250 });
});

test('receipt_date is cast to text so the driver never hands back a Date object', () => {
  assert.ok(CLAIM_RETURNING.includes('receipt_date::text AS receipt_date'));
  assert.ok(CLAIM_COLUMNS.includes('c.receipt_date::text AS receipt_date'));
  assert.ok(!CLAIM_COLUMNS.includes('c.receipt_date,'));
});
