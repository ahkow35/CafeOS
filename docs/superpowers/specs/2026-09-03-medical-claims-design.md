# Medical Claims — Design

**Date:** 2026-09-03
**Status:** approved in chat, awaiting spec review
**Scope:** employees submit medical claim receipts against a per-employee yearly
balance; the café owner approves (optionally at a lower amount) or rejects.

## 1. Decisions (locked)

| Question | Decision |
|---|---|
| Balance model | Per-employee yearly cap, plain column on `cafe_memberships`, manual reset by owner (no automatic rollover). |
| Deduction timing | On approval only. Submit reserves nothing in the DB; the over-submit check subtracts pending claims at submit time. |
| Approver | Owner only. Managers see the queue read-only. |
| Amount | Owner may approve a lower amount than claimed. Deduction uses `amount_approved`. |
| Claim types | Medical only. One balance column. |
| Receipt | Mandatory, exactly one file per claim (JPEG/PNG/HEIC/PDF, ≤ 5 MB). |
| Owner's own claim | Auto-approved on submit (mirrors owner leave). |
| Entry points | "Medical Claims" button on the Leave page; card on the admin dashboard. No new bottom-nav tab. |
| Cancel / purge | Cancelling a pending claim refunds nothing. Owner purging an approved claim refunds `amount_approved`. |
| Receipt date | Not in the future (evaluated in `Asia/Singapore`). Prior-year receipts allowed. |
| Amount limits | > 0, at most 2 decimals, ≤ 9,999.99. Currency SGD. |
| Delivery | Two PRs: (1) storage/streaming generalisation, (2) feature. Migration applied to prod before PR 2 merges. |

## 2. Schema

Migration file: `db/migrations/2026-09-03-medical-claims.sql`. `db/schema.sql`
updated in the same PR (repo keeps both). Additive and reversible.

```sql
BEGIN;

ALTER TABLE public.cafe_memberships
  ADD COLUMN IF NOT EXISTS medical_claim_balance NUMERIC(10,2) NOT NULL DEFAULT 0
    CHECK (medical_claim_balance >= 0);

CREATE TABLE IF NOT EXISTS public.medical_claims (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cafe_id         UUID NOT NULL REFERENCES public.cafes(id),
    user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    receipt_date    DATE NOT NULL,
    amount_claimed  NUMERIC(10,2) NOT NULL CHECK (amount_claimed > 0 AND amount_claimed <= 9999.99),
    amount_approved NUMERIC(10,2)          CHECK (amount_approved IS NULL OR
                                                 (amount_approved > 0 AND amount_approved <= amount_claimed)),
    description     TEXT,
    receipt_url     TEXT NOT NULL,            -- Vercel Blob URL; never sent raw to clients
    status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected')),
    decided_by      UUID REFERENCES public.profiles(id),
    decided_at      TIMESTAMPTZ,
    decision_note   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT medical_claims_decided_consistent CHECK (
      (status = 'pending'  AND amount_approved IS NULL AND decided_by IS NULL AND decided_at IS NULL) OR
      (status = 'approved' AND amount_approved IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL) OR
      (status = 'rejected' AND amount_approved IS NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_claims_cafe_user   ON public.medical_claims(cafe_id, user_id);
CREATE INDEX IF NOT EXISTS idx_claims_cafe_status ON public.medical_claims(cafe_id, status);

-- updated_at trigger: reuse public.touch_updated_at() (same as leave_requests).
-- audit trigger: log_claim_change() — copy of log_leave_change() with entity 'medical_claim'.

COMMIT;
```

Rollback: `DROP TABLE medical_claims; ALTER TABLE cafe_memberships DROP COLUMN medical_claim_balance;`

Post-apply verification (prod): column present with default 0 on every existing
membership row; table has 14 columns, 2 indexes, 2 triggers; leave data untouched.

### Money handling
- All arithmetic in SQL (`SET medical_claim_balance = medical_claim_balance - $1`).
- `@vercel/postgres` returns NUMERIC as strings. Route row types declare these
  fields as `string`; the API layer converts with a single `toMoney(s): number`
  helper (parse + 2 dp) before responding. No float arithmetic on the server.
- Input parsing: new `parseMoney(input, label, max = 9999.99)` in `lib/validators.ts`
  — finite, > 0, at most 2 dp (checked on the string form, not by rounding), ≤ max.

## 3. Storage (PR 1 — preparatory refactor)

`lib/storage.ts` currently hardcodes the `medical-certificates` prefix in
`uploadMedicalCert`, `isValidOwnCertUrl`, and `ownerFromPath`. Generalise:

```ts
export type AttachmentKind = 'medical-cert' | 'claim-receipt';
const PREFIX: Record<AttachmentKind, string> = {
  'medical-cert': 'medical-certificates',
  'claim-receipt': 'claim-receipts',
};
uploadAttachment(kind, { userId, cafeId, file, filename, contentType })
isValidOwnAttachmentUrl(kind, url, cafeId, userId)
deleteAttachment(urlOrPathname)
```

Existing callers updated in place (leave POST, medical-cert upload route, leave
DELETE). `ownerFromPath` is unused — delete it.

The gated read route body (`/api/leave-requests/[id]/attachment`) moves to
`lib/storage.ts` as `streamGatedAttachment(url): Promise<Response>` (trusted-host
check, upstream fetch, forced-download headers, nosniff, no-store). The leave
route becomes auth + lookup + one call. Same headers, same behaviour.

Upload route body is likewise shared: `handleAttachmentUpload(kind, req)` in a
new `lib/uploads.ts` (size/mime gate + upload), used by both upload routes.

PR 1 contains only these moves plus the migration file. No behaviour change.
Verified by: `tsc`, `eslint --quiet`, `next build`, and a manual leave-with-MC
submit + open-attachment in the browser against local Postgres.

## 4. API (PR 2)

All routes: `runtime = 'nodejs'`, same error mapping as leave routes
(`ValidationError` → 400, `AuthError` → 401/403, `RequestConflictError` → 409,
`isDbUnavailable` → 503).

### `POST /api/uploads/claim-receipt`
`requireTenantUser`; multipart `file`; delegates to `handleAttachmentUpload('claim-receipt')`.
Returns `{ url, pathname }`.

### `GET /api/claims?scope=mine|pending|history`
- `mine` — caller's own rows in this café, newest first.
- `pending` — `requireManagerInCafe`; all pending rows in café joined with
  `profiles.full_name`, `cafe_memberships.role`, `cafe_memberships.medical_claim_balance`.
- `history` — `requireManagerInCafe`; approved/rejected rows, newest first, same join.
  Managers see staff and part-timer rows only (same rule as leave history).
- Every row's `receipt_url` is rewritten to `/api/claims/{id}/receipt` before responding.
- Response shape: `{ claims: Claim[] }`, with `profile: { full_name, role, medical_claim_balance }`
  on the manager scopes. Money fields are numbers.

### `POST /api/claims`
Body `{ receipt_date, amount_claimed, description?, receipt_url }`.

Validation, in order: date format `YYYY-MM-DD` and parseable; not after today
in `Asia/Singapore`; `parseMoney(amount_claimed)`; description trimmed, optional,
≤ 500 chars; `receipt_url` required and `isValidOwnAttachmentUrl('claim-receipt', …)`.

Inside `withTenantTx`:
1. `SELECT m.medical_claim_balance, p.full_name FROM cafe_memberships m JOIN profiles p … FOR UPDATE OF m`.
2. `SELECT COALESCE(SUM(amount_claimed),0) FROM medical_claims WHERE user_id AND cafe_id AND status='pending'`.
3. If `amount_claimed > balance - pending_sum` → `ValidationError`
   ("Claim exceeds available balance. Available $X (after $Y pending).").
4. If caller role is `owner`: insert as `approved` with `amount_approved = amount_claimed`,
   `decided_by = caller`, `decided_at = NOW()`, and deduct `amount_claimed` from the
   membership in the same transaction. Otherwise insert as `pending`; no deduction.

After commit (only when pending): `after(notifyClaimSubmitted)` to café owners.
Returns 201 `{ claim }` with gated receipt URL.

### `PATCH /api/claims/[id]`
`requireOwnerInCafe`. Body `{ action: 'approve', amount_approved? }` or
`{ action: 'reject', note? }`. Note trimmed, optional, ≤ 500 chars.

Pre-check outside tx: row exists in café; status pending (else 409).

Inside `withTenantTx`:
1. `SELECT … FROM medical_claims WHERE id AND cafe_id FOR UPDATE` → re-check pending (else `RequestConflictError`).
2. **approve**: `amount_approved` defaults to `amount_claimed`; `parseMoney` it;
   must be ≤ `amount_claimed` (400). Lock membership row `FOR UPDATE`; if
   `amount_approved > medical_claim_balance` → 400 ("Balance is $X; cannot approve $Y").
   `UPDATE medical_claims SET status='approved', amount_approved, decided_by, decided_at=NOW()
   WHERE id AND cafe_id AND status='pending' RETURNING …`; if 0 rows → conflict.
   Then `UPDATE cafe_memberships SET medical_claim_balance = medical_claim_balance - $1`.
3. **reject**: `UPDATE … SET status='rejected', decided_by, decided_at=NOW(), decision_note
   WHERE … AND status='pending' RETURNING …`; if 0 rows → conflict. No balance change.

After commit: `after(notifyClaimDecision)` to the employee. Returns `{ claim }`.

### `DELETE /api/claims/[id]`
- Employee may delete own **pending** claim (cancel). No balance change.
- Owner may delete any pending claim (no balance change) or any decided claim
  (purge). Purging an **approved** claim refunds `amount_approved` inside the tx
  under `FOR UPDATE`; purging a rejected claim changes nothing.
- Managers: 403 on anything not their own pending claim.
- Blob delete best-effort after commit (`deleteAttachment`).

### `GET /api/claims/[id]/receipt`
`requireTenantUser`; row in café; own row or manager/owner; `streamGatedAttachment(receipt_url)`.

### Existing routes touched
- `PATCH /api/admin/users/[id]` — accepts `medical_claim_balance` via `parseMoney(…, max 99999.99)`
  allowing 0. Written through the existing employment-update `COALESCE` path.
- `GET /api/admin/users` and `/api/auth/me` — include `medical_claim_balance` in the
  membership/employment projection (wherever `medical_leave_balance` is selected).

### Notifications (`lib/notifications.ts`)
- `notifyClaimSubmitted({ cafeId, requesterName, amount, receiptDate })` → all owners
  with a linked Telegram chat (reuse the owner-chat-ids helper).
- `notifyClaimDecision({ cafeId, requesterUserId, amountClaimed, amountApproved, approved, note })` → employee.
- Every dynamic string goes through the existing `esc()` helper (messages use `parse_mode: 'HTML'`).
  Amounts formatted `S$1,234.50`.

## 5. UI (PR 2)

Follows the leave pages' structure, class names, and the `jsonOrError` fetch pattern.

### `/c/[slug]/claims` (all roles)
- Header "Medical Claims", subtitle "Submit receipts against your yearly cap".
- `ClaimBalanceCard`: available balance (large, S$), and a smaller "S$X pending" line
  when pending claims exist. Available = `profile.medical_claim_balance`; pending sum
  computed client-side from the `mine` list.
- "Submit a Claim" primary button → `/c/[slug]/claims/new`.
- Pending section with `ClaimCard` (date, amount, description, "View receipt", Cancel with confirm).
- History section with `ClaimCard` (status pill, approved amount if lower than claimed, note).

### `/c/[slug]/claims/new`
`ClaimForm` component: receipt date (`max` = today SGT), amount (`inputMode="decimal"`,
`step="0.01"`), description (optional textarea), receipt file (required). Flow: upload
file first to `/api/uploads/claim-receipt`, then POST the claim with the returned URL,
same two-step as `LeaveApplicationForm`. Client shows available balance minus pending
and blocks obvious over-claims before the round-trip; the server remains authoritative.

### `/c/[slug]/admin/claims` (manager + owner)
- Redirects non-admin roles to `/c/[slug]/claims`.
- Pending queue: each row shows employee name, role, current balance, date, amount,
  description, "View receipt". Owner controls: an amount input prefilled with
  `amount_claimed` (capped at that value), Approve, Reject (prompts for optional note).
  Managers see the rows with no controls and a "Owner approval required" hint.
- History list (toggle), with Delete (owner only, confirm; message states the refund
  amount when approved).

### Entry points and nav
- Leave page: secondary button "Medical Claims" beneath "Apply for Leave".
- Admin dashboard (`/c/[slug]/admin`): a card linking to `/admin/claims`, showing
  pending count from the `pending` scope (owner and manager).
- `PendingApprovalsWidget` is leave-specific (fetches only leave rows); left unchanged.
- Bottom nav unchanged.

### Staff page (`/c/[slug]/admin/staff`)
New "Medical claim cap (S$)" field per member: numeric input with Save, not a
+/- stepper. Uses the existing `patchUser` helper with `{ medical_claim_balance }`.

### Types
`lib/database.types.ts`: add `medical_claim_balance: number` beside the leave
balances on the User/membership shapes, and a `MedicalClaim` interface matching
the API response (money fields `number`, `receipt_url: string`).

## 6. Error handling
- Concurrency: every balance-affecting write holds `FOR UPDATE` on the membership
  row (submit, approve, purge) and on the claim row (approve, reject, delete).
  Second concurrent decision gets 409, never a double deduction or refund.
- Owner edits balance between submit and approve: approve re-checks under lock and
  returns 400 with both figures; the claim stays pending.
- Upload succeeds but claim POST fails: orphaned blob under the user's own prefix.
  Accepted (same as leave today); no cleanup job.
- Blob delete failure on DELETE: logged, request still succeeds (same as leave).

## 7. Verification
No test suite exists. Follow the PR #7 precedent:
1. Throwaway local Postgres seeded from `db/schema.sql` + the migration. Script under
   the session scratchpad exercises the SQL **extracted from the route files** for:
   submit within balance, submit exceeding balance, submit exceeding balance-minus-pending,
   owner auto-approve, approve at claimed amount, approve at lower amount, approve
   exceeding current balance, approve when already decided (409), reject, cancel pending,
   purge approved (refund), purge rejected (no refund), two concurrent approves.
2. `tsc --noEmit`, `eslint --quiet`, `next build` clean.
3. Browser run against local DB: staff submits with receipt → owner sees queue → approve
   at lower amount → staff balance and history reflect it → receipt opens via gated route
   → manager sees queue without controls → staff page cap edit persists.
4. `verify-done` before the PR is declared ready.

## 8. Sequencing
1. PR 1 (refactor + migration file) → review → merge.
2. Apply migration to production; verify per §2.
3. PR 2 (feature) → review → merge (= deploy).
4. Post-deploy smoke: one real claim end to end; CHANGELOG entry.
