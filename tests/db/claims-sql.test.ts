/**
 * SQL-level tests for the medical-claims flow, run against a throwaway Postgres
 * seeded from db/schema.sql. Skipped unless TEST_DATABASE_URL is set.
 *
 * The statements below are the SAME strings the routes execute. If you edit a
 * query in src/app/api/claims, edit it here too — the point is to test what ships.
 */
import { describe, test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';

const url = process.env.TEST_DATABASE_URL;
// `skip` goes on the describe() only — node:test hooks accept no skip option.
const skip = url ? false : 'TEST_DATABASE_URL not set';

const pool = url ? new Pool({ connectionString: url }) : null;
let cafe = '';
let owner = '';
let staff = '';

async function q<T extends Record<string, unknown> = Record<string, unknown>>(text: string, params: unknown[] = []) {
  const r = await pool!.query(text, params);
  return r.rows as T[];
}

const RETURNING = 'id, user_id, receipt_date::text AS receipt_date, amount_claimed, amount_approved, description, receipt_url, status, decided_by, decided_at, decision_note, created_at, updated_at';

const AVAILABLE_SQL = `SELECT (m.medical_claim_balance - COALESCE(SUM(c.amount_claimed), 0))::numeric(10,2) AS available,
                COALESCE(SUM(c.amount_claimed), 0)::numeric(10,2) AS pending
           FROM cafe_memberships m
           LEFT JOIN medical_claims c
             ON c.user_id = m.user_id AND c.cafe_id = m.cafe_id AND c.status = 'pending'
          WHERE m.user_id = $1 AND m.cafe_id = $2
          GROUP BY m.medical_claim_balance`;

const INSERT_SQL = `INSERT INTO medical_claims
            (cafe_id, user_id, receipt_date, amount_claimed, description, receipt_url,
             status, amount_approved, decided_by, decided_at)
         VALUES ($1, $2, $3, $4, $5, $6,
                 CASE WHEN $7::boolean THEN 'approved' ELSE 'pending' END,
                 CASE WHEN $7::boolean THEN $4::numeric ELSE NULL END,
                 CASE WHEN $7::boolean THEN $2::uuid ELSE NULL END,
                 CASE WHEN $7::boolean THEN NOW() ELSE NULL END)
         RETURNING ${RETURNING}`;

const APPROVE_SQL = `UPDATE medical_claims
              SET status = 'approved', amount_approved = $1::numeric,
                  decided_by = $2, decided_at = NOW(), decision_note = NULL
            WHERE id = $3 AND cafe_id = $4 AND status = 'pending'
            RETURNING ${RETURNING}`;

const REJECT_SQL = `UPDATE medical_claims
            SET status = 'rejected', decided_by = $1, decided_at = NOW(), decision_note = $2
          WHERE id = $3 AND cafe_id = $4 AND status = 'pending'
          RETURNING ${RETURNING}`;

const DEDUCT_SQL = `UPDATE cafe_memberships SET medical_claim_balance = medical_claim_balance - $1::numeric
            WHERE user_id = $2 AND cafe_id = $3`;
const REFUND_SQL = `UPDATE cafe_memberships SET medical_claim_balance = medical_claim_balance + $1::numeric
            WHERE user_id = $2 AND cafe_id = $3`;

// Verbatim from PATCH /api/claims/[id] (approve branch) — locks the claimant's
// membership row to re-check the balance against the amount being approved.
const MEMBERSHIP_LOCK_SQL = `SELECT medical_claim_balance FROM cafe_memberships
            WHERE user_id = $1 AND cafe_id = $2 FOR UPDATE`;

const URL_FOR = (u: string) => `https://x.public.blob.vercel-storage.com/claim-receipts/${cafe}/${u}/1-r.jpg`;

async function balance(u: string): Promise<number> {
  const r = await q<{ b: string }>(`SELECT medical_claim_balance AS b FROM cafe_memberships WHERE user_id = $1 AND cafe_id = $2`, [u, cafe]);
  return Number(r[0].b);
}

async function submit(u: string, amount: string, auto = false) {
  const r = await q<{ id: string; status: string }>(INSERT_SQL, [cafe, u, '2026-09-01', amount, null, URL_FOR(u), auto]);
  if (auto) await q(DEDUCT_SQL, [amount, u, cafe]);
  return r[0];
}

describe('claims sql', { skip }, () => {

before(async () => {
  await q(`DELETE FROM medical_claims`);
  await q(`DELETE FROM cafe_memberships`);
  await q(`DELETE FROM cafes`);
  await q(`DELETE FROM profiles`);
  const c = await q<{ id: string }>(`INSERT INTO cafes (slug, name, status) VALUES ('t-cafe', 'T', 'active') RETURNING id`);
  cafe = c[0].id;
  const o = await q<{ id: string }>(`INSERT INTO profiles (phone_e164, full_name, pin_hash) VALUES ('+6511111111', 'Owner', 'x') RETURNING id`);
  owner = o[0].id;
  const s = await q<{ id: string }>(`INSERT INTO profiles (phone_e164, full_name, pin_hash) VALUES ('+6522222222', 'Staff', 'x') RETURNING id`);
  staff = s[0].id;
  await q(`INSERT INTO cafe_memberships (cafe_id, user_id, role, medical_claim_balance) VALUES ($1, $2, 'owner', 500), ($1, $3, 'staff', 300)`, [cafe, owner, staff]);
});

// Every test starts from the same known state: no claims, owner balance 500,
// staff balance 300. Nothing below may rely on residue left by another test.
beforeEach(async () => {
  await q(`DELETE FROM medical_claims`);
  await q(
    `UPDATE cafe_memberships SET medical_claim_balance = CASE WHEN user_id = $1 THEN 500 ELSE 300 END WHERE cafe_id = $2`,
    [owner, cafe],
  );
});

after(async () => { await pool?.end(); });

test('available = balance − pending', async () => {
  const a0 = await q<{ available: string; pending: string }>(AVAILABLE_SQL, [staff, cafe]);
  assert.equal(Number(a0[0].available), 300);
  await submit(staff, '80.00');
  const a1 = await q<{ available: string; pending: string }>(AVAILABLE_SQL, [staff, cafe]);
  assert.equal(Number(a1[0].available), 220);
  assert.equal(Number(a1[0].pending), 80);
  assert.equal(await balance(staff), 300, 'submit must not deduct');
});

// The following three tests mirror, in test code, the JS guards the route applies
// before it ever touches INSERT_SQL/APPROVE_SQL/DEDUCT_SQL; the guards themselves
// are exercised end-to-end in the Task 15 browser walk.
test('submit exceeding balance: amount > available is rejected by the route guard', async () => {
  const a = await q<{ available: string; pending: string }>(AVAILABLE_SQL, [staff, cafe]);
  assert.equal(Number(a[0].available), 300);
  assert.ok(301 > Number(a[0].available));
  const rows = await q(`SELECT id FROM medical_claims WHERE user_id = $1 AND cafe_id = $2`, [staff, cafe]);
  assert.equal(rows.length, 0, 'route throws before INSERT_SQL runs; no row inserted for the rejected amount');
});

test('submit exceeding balance minus pending: amount > available (with pending) is rejected by the route guard', async () => {
  await submit(staff, '80.00');
  const a = await q<{ available: string; pending: string }>(AVAILABLE_SQL, [staff, cafe]);
  assert.equal(Number(a[0].available), 220);
  assert.equal(Number(a[0].pending), 80);
  assert.ok(221 > Number(a[0].available));
});

test('approve exceeding current balance: amount_approved > balance is rejected by the route guard', async () => {
  const c = await submit(staff, '100.00');
  await q(`UPDATE cafe_memberships SET medical_claim_balance = 50 WHERE user_id = $1 AND cafe_id = $2`, [staff, cafe]);
  const bal = await q<{ medical_claim_balance: string }>(MEMBERSHIP_LOCK_SQL, [staff, cafe]);
  assert.ok(100 > Number(bal[0].medical_claim_balance));
  const row = await q<{ status: string }>(`SELECT status FROM medical_claims WHERE id = $1 AND cafe_id = $2`, [c.id, cafe]);
  assert.equal(row[0].status, 'pending', 'route throws before APPROVE_SQL/DEDUCT_SQL run; claim stays pending');
});

test('approve at lower amount deducts the approved amount only once', async () => {
  const c = await submit(staff, '100.00');
  const r = await q<{ status: string; amount_approved: string }>(APPROVE_SQL, ['60.00', owner, c.id, cafe]);
  assert.equal(r[0].status, 'approved');
  assert.equal(Number(r[0].amount_approved), 60);
  await q(DEDUCT_SQL, ['60.00', staff, cafe]);
  assert.equal(await balance(staff), 240);
  const again = await q(APPROVE_SQL, ['60.00', owner, c.id, cafe]);
  assert.equal(again.length, 0, 'second approve must match zero rows');
});

test('reject leaves the balance untouched and stores the note', async () => {
  const c = await submit(staff, '20.00');
  const r = await q<{ status: string; decision_note: string }>(REJECT_SQL, [owner, 'not a medical receipt', c.id, cafe]);
  assert.equal(r[0].status, 'rejected');
  assert.equal(r[0].decision_note, 'not a medical receipt');
  assert.equal(await balance(staff), 300);
});

test('cancel pending: claimant deletes their own pending claim with no balance change', async () => {
  const c = await submit(staff, '30.00');
  await q(`DELETE FROM medical_claims WHERE id = $1 AND cafe_id = $2`, [c.id, cafe]);
  const rows = await q(`SELECT id FROM medical_claims WHERE id = $1 AND cafe_id = $2`, [c.id, cafe]);
  assert.equal(rows.length, 0);
  assert.equal(await balance(staff), 300);
});

test('owner auto-approve deducts immediately', async () => {
  const c = await submit(owner, '50.00', true);
  assert.equal(c.status, 'approved');
  assert.equal(await balance(owner), 450);
});

test('purging an approved claim refunds amount_approved', async () => {
  const c = await submit(staff, '30.00');
  await q(APPROVE_SQL, ['25.00', owner, c.id, cafe]);
  await q(DEDUCT_SQL, ['25.00', staff, cafe]);
  assert.equal(await balance(staff), 275);
  await q(`DELETE FROM medical_claims WHERE id = $1 AND cafe_id = $2`, [c.id, cafe]);
  await q(REFUND_SQL, ['25.00', staff, cafe]);
  assert.equal(await balance(staff), 300);
});

test('purging a rejected claim does not refund', async () => {
  const c = await submit(staff, '30.00');
  await q(REJECT_SQL, [owner, null, c.id, cafe]);
  await q(`DELETE FROM medical_claims WHERE id = $1 AND cafe_id = $2`, [c.id, cafe]);
  assert.equal(await balance(staff), 300);
});

test('constraints: amount_approved > amount_claimed, negative balance, inconsistent decided rows', async () => {
  const c = await submit(staff, '10.00');
  await assert.rejects(q(APPROVE_SQL, ['10.01', owner, c.id, cafe]), /medical_claims_amount_approved_within_claimed/);
  await assert.rejects(q(DEDUCT_SQL, ['99999.00', staff, cafe]), /medical_claim_balance_check|check constraint/i);
  await assert.rejects(
    q(`UPDATE medical_claims SET status = 'approved' WHERE id = $1`, [c.id]),
    /medical_claims_decided_consistent/,
  );
});

test('two concurrent approves: exactly one wins', async () => {
  const c = await submit(staff, '40.00');
  const a = pool!.connect();
  const b = pool!.connect();
  const [ca, cb] = await Promise.all([a, b]);
  try {
    await ca.query('BEGIN'); await cb.query('BEGIN');
    const lockA = ca.query(`SELECT status FROM medical_claims WHERE id = $1 AND cafe_id = $2 FOR UPDATE`, [c.id, cafe]);
    const lockB = cb.query(`SELECT status FROM medical_claims WHERE id = $1 AND cafe_id = $2 FOR UPDATE`, [c.id, cafe]);
    await lockA;                                   // A holds the lock; B blocks
    const rA = await ca.query(APPROVE_SQL, ['40.00', owner, c.id, cafe]);
    await ca.query(DEDUCT_SQL, ['40.00', staff, cafe]);
    await ca.query('COMMIT');
    const sB = await lockB;                        // B now sees the committed state
    assert.equal(rA.rowCount, 1);
    assert.equal(sB.rows[0].status, 'approved');   // route would throw RequestConflictError here
    await cb.query('ROLLBACK');
  } finally {
    ca.release(); cb.release();
  }
  assert.equal(await balance(staff), 260);
});

}); // describe
