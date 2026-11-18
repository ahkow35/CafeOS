import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIMESHEET_STATUSES } from '../src/lib/workflows/timesheet';
import { LEAVE_STATUSES } from '../src/lib/workflows/leave';
import { CLAIM_STATUSES } from '../src/lib/workflows/claim';
import { CAFE_STATUSES } from '../src/lib/workflows/cafe';
import {
  CAFE_LABELS,
  CLAIM_LABELS,
  LEAVE_LABELS,
  TIMESHEET_LABELS,
  TONE_CLASS,
  statusLabel,
  type StatusLabel,
} from '../src/lib/workflows/labels';

const TABLES: Array<[string, readonly string[], Record<string, StatusLabel>]> = [
  ['timesheet', TIMESHEET_STATUSES, TIMESHEET_LABELS],
  ['leave', LEAVE_STATUSES, LEAVE_LABELS],
  ['claim', CLAIM_STATUSES, CLAIM_LABELS],
  ['cafe', CAFE_STATUSES, CAFE_LABELS],
];

for (const [name, statuses, labels] of TABLES) {
  test(`${name}: every status has a non-empty label and a known tone`, () => {
    assert.deepEqual(Object.keys(labels).sort(), [...statuses].sort());
    for (const s of statuses) {
      assert.ok(labels[s].label.length > 0);
      assert.ok(labels[s].tone in TONE_CLASS, `${name}.${s} tone ${labels[s].tone}`);
    }
  });
}

test('the label text and tone of every status, word for word', () => {
  assert.deepEqual(TIMESHEET_LABELS, {
    draft: { label: 'Draft', tone: 'draft' },
    submitted: { label: 'Awaiting manager', tone: 'manager' },
    pending_owner: { label: 'Awaiting owner', tone: 'owner' },
    approved: { label: 'Approved', tone: 'approved' },
    rejected: { label: 'Declined', tone: 'declined' },
  });
  assert.deepEqual(LEAVE_LABELS, {
    pending_manager: { label: 'Awaiting manager', tone: 'manager' },
    pending_owner: { label: 'Awaiting owner', tone: 'owner' },
    approved: { label: 'Approved', tone: 'approved' },
    rejected: { label: 'Declined', tone: 'declined' },
  });
  assert.deepEqual(CLAIM_LABELS, {
    pending: { label: 'Awaiting owner', tone: 'owner' },
    approved: { label: 'Approved', tone: 'approved' },
    rejected: { label: 'Declined', tone: 'declined' },
  });
  assert.deepEqual(CAFE_LABELS, {
    pending: { label: 'Awaiting approval', tone: 'manager' },
    active: { label: 'Active', tone: 'approved' },
    suspended: { label: 'Suspended', tone: 'declined' },
  });
});

test('each tone maps to its badge class', () => {
  assert.deepEqual(TONE_CLASS, {
    draft: 'badge-info',
    manager: 'badge-warning',
    owner: 'badge-owner',
    approved: 'badge-success',
    declined: 'badge-danger',
  });
});

test('statusLabel finds a known status and returns nothing for an unknown one', () => {
  assert.equal(statusLabel('leave', 'pending_manager')?.label, 'Awaiting manager');
  assert.equal(statusLabel('leave', 'weird'), undefined);
  assert.equal(statusLabel('claim', 'toString'), undefined);
});
