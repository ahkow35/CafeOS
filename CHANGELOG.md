# Changelog

## 2026-08-06 — Timesheet 0-hours fix, payroll-integrity hardening, PIN reset shipped

### Summary
Three merges after the outage work: PR #7 (timesheet hours), PR #8 (self-service PIN reset,
built by a separate session). One production schema migration applied. All deployed and
verified live; the PIN reset flow was confirmed end to end including Telegram delivery.

### Schema change (applied to prod BEFORE the merge that needs it)
- `db/migrations/2026-08-06-pin-reset-tokens.sql` — new `pin_reset_tokens` table: HMACed
  `code_hash`, hashed `request_ip_hash`, `attempts_remaining` 0–5 CHECK, `expires_at`,
  `used_at`, FK to `profiles` ON DELETE CASCADE, two indexes. Applied ahead of PR #8
  because this repo deploys on merge — the table sat unused until the code shipped.
  Verified after: 8 columns, 3 indexes, 3 constraints, existing data untouched.
  Reversible with `DROP TABLE pin_reset_tokens`.

### PR #7 — timesheet showed 0 hours (`f6422ab` → `80a9b9f`)
Reported from the floor: a saved timesheet showed `0` in HRS and TOTAL HOURS despite correct
clock times; tapping any time field made the real figure appear, which looked like a saving
fault. It was not — the times always saved; the hours were never *calculated*.

- **Root cause** — `computeHours()` required exactly `"HH:MM"` and returned **0** for anything
  else, silently. Postgres renders a `time` column as `"12:30:00"`, so every value loaded from
  the API arrived with seconds and scored zero. A blur re-normalised it to `"HH:MM"`, which is
  why touching a field appeared to repair the row. Fixed to accept both forms (and `24:00`)
  while still rejecting genuine rubbish.
- **Payroll-integrity hole closed** — `PATCH /api/timesheet-entries/[id]` stored whatever
  `total_hours` the client sent, using that same broken calculation. Editing only the break on
  a saved row would have written **0 payable hours**, which the manager view and Excel export
  both read. It now derives server-side from the **merged** row under `FOR UPDATE` (deriving
  from the request body alone would zero the hours whenever a single field is sent). The POST
  path already enforced this rule; the two paths disagreed.
- **Duplicate calculation collapsed** — the server had a near-copy of `computeHours` that
  tolerated seconds *by accident*. That is how the two drifted apart unnoticed. Now one shared
  `deriveTotalHours()` in `lib/timeUtils`.
- **`isDbUnavailable()` corrected** — only a real 5-char SQLSTATE may decide; `@vercel/postgres`
  puts word codes (`invalid_connection_string`) in `err.code`, which the previous version read
  as a SQLSTATE and classified a misconfigured database as a code bug (500) not infrastructure
  (503). **Found by running the app against a broken database, not by reading it.**
- **No production rows were affected**: 0 of 26 entries with both times had hours stored as 0.

### PR #8 — self-service PIN reset (`3a0a717`)
Built by a separate Claude Code session and left uncommitted in the shared checkout; committed
to a branch, reviewed for security, and merged at Nyan's explicit direction.

- `pin_reset_tokens` + `lib/pinReset`: 6-digit codes, HMAC-SHA256 (never plaintext at rest),
  constant-time compare, 10-minute TTL, single-use, 5 attempts, 3/hour per account, 10/hour
  per IP, hashed IPs. Success bumps `profiles.token_version` (revokes live sessions), clears
  `failed_attempts`/`locked_until`, invalidates outstanding tokens, clears cookies.
- Routes: `pin-reset/request`, `pin-reset/confirm`, `change-pin`. Pages: `/login/reset`,
  per-cafe account page. Plus a UI refresh (`globals.css` +290, Header, BottomNav, layout).
- **Caveat on record:** ~400 lines of account-recovery code merged with **no human review**.

### Verification
No test suite in this repo. PR #7 was verified on a **throwaway local Postgres** (production
never written to): 10 PATCH cases incl. break-only, remarks-only, single-clock-time, cleared
time and overnight — with the SQL **extracted from the route file rather than retyped**, so the
test cannot pass against a stale query; plus 17 hours cases and 17 classifier cases. `tsc`,
`eslint --quiet` and `next build` clean throughout.

PR #8 verified live in production: unknown number returns the same generic message as a real
one (no account enumeration), a bad code returns 400 not 500, and a real request created a
token and **delivered the code to Telegram** (confirmed received). Only confirm-with-a-valid-code
is unexercised. The test token was invalidated afterwards; no account was altered.

### Operational note
**Two PIN flows, easily confused.** `/c/<slug>/account` → `change-pin` is for a **logged-in**
user and deliberately sends **no** Telegram code (identity already proven). `/login/reset` →
`pin-reset/request` is for a **locked-out** user and is the only one that sends a code.
Telegram is the only private channel CafeOS has — no email, no SMS — so an unlinked profile can
never self-recover, and currently **only 2 of 9 profiles are linked**. Those 7 users will see
the same "a verification code is on its way" message and receive nothing, because the wording
is deliberately generic to prevent phone-number enumeration.

## 2026-08-06 — Production outage (stale DB credential) + login error-message fix

### Summary
Production returned `Login failed` to every user. The cause was infrastructure, not code: the Neon
credentials were re-provisioned ~31 Jul, but the live deployment dated from 14 Jul and Vercel binds
env vars into a deployment **at build time** — so the running build kept presenting the old password.
Restored by redeploying, with no code change. A follow-up PR then fixed how the failure *presented*.

### Incident
- **Symptom** — `Login failed` under the PIN field on `/login`. Because that string sits beside a
  credentials form, staff read a total outage as their own typo and retried correct PINs.
- **Root cause** — `NeonDbError: password authentication failed for user 'neondb_owner'` on every
  query. `vercel env ls production` showed all Postgres vars 6 days old; the newest Production
  deployment was 23 days old. That age gap is the whole diagnosis.
- **Fix** — `vercel redeploy <prod-url>`: same source, rebuilt against current env. Verified live —
  login went 500 → 401 for a nonexistent number, and `/api/auth/me` went 503 → 200.
- **Diagnostics worth reusing** — (1) probe with knowingly-invalid credentials: a 500 where a 401 is
  expected proves the failure precedes credential evaluation, so it affects every user rather than
  the one complaining; (2) hash-compare the stored env value against a known-working local one to
  tell "stored value is stale" from "stored value is fine, needs a redeploy", without printing a
  secret; (3) `profiles.failed_attempts` still at 0 proves the PIN check was never reached.

### Code changes (PR #5, squash `f6422ab`)
- `src/lib/db.ts` — new `isDbUnavailable()`: SQLSTATE first (connection class `08`, authorization
  class `28`, `53300`, `57P03`), then message matching. The fallback is load-bearing, not
  belt-and-braces — Neon's HTTP driver reported this outage with `severity: ''` and **`code: ''`**,
  so a code-only classifier misses precisely the failure that caused the incident.
- `src/app/api/auth/login/route.ts` — database unreachable → **503** `service_unavailable`; a genuine
  bug → 500 `server_error`. Both messages state that the PIN is not the problem. A malformed query
  or missing column deliberately stays a 500, so real defects are not disguised as outages.
- `src/context/AuthContext.tsx` — the two client-side fallbacks also said `Login failed`. They now
  cover what the server never sees: a platform 502 with no JSON body, and a dropped connection
  (whose raw `Failed to fetch` means nothing to a barista at the till).

### Verification
This repo has **no test suite**. The outage was reproduced locally (real Neon host, deliberately
wrong password) → 503 with the new message; with a healthy DB, login still returns 401 for bad
credentials and 400 for a malformed PIN. A 15-case standalone classifier script passes, including
the negatives that matter (42703 missing column, 42601 syntax error, 23505 unique violation, plain
`TypeError`, non-`Error` values). `tsc --noEmit`, `eslint . --quiet`, and `next build` all clean;
the 12 `react-hooks/exhaustive-deps` warnings are pre-existing in untouched files.

Not verified in production: the 503 path itself, since observing it would mean breaking the live
database. It is proven by local reproduction only.

### Carry forward
Rotating a credential in Vercel does not reach a running deployment — **redeploy immediately after
any rotation**, and treat "env var newer than the last deployment" as a standing production alarm.
Also confirmed this session: **this project auto-deploys on merge to `main`** (the branch push built
a preview; the merge deployed production without touching the CLI), so a merge *is* the deploy.

## 2026-07-14 — Security remediation from code review (Phases 0–3)

### Summary
Fixed all five critical merge-blockers plus the payroll-integrity core surfaced by a
full-codebase security review. Deployed to production (`cafe-os` on Vercel) and verified
live; both schema migrations applied to Neon (`neondb`).

### Schema changes (applied to prod)
- `db/migrations/2026-07-13-employment-to-membership.sql` — moves café-scoped employment
  data (`job_title`, `annual_leave_balance`, `medical_leave_balance`, `hourly_rate`,
  `employment_active`) from the global `profiles` row onto `cafe_memberships`; adds
  `profiles.token_version` for session revocation. Additive + idempotent; backfilled 8
  memberships. Old `profiles` employment columns kept (deprecated) pending soak.
- `db/migrations/2026-07-13-telegram-link-codes.sql` — new `telegram_link_codes` table for
  authenticated, single-use, short-lived Telegram link codes.

### Blockers fixed
- **Stripe webhook auth** — `/api/webhooks/stripe` added to middleware public prefix; it was
  401'd before signature verification could run (`src/middleware.ts`).
- **Cross-tenant account takeover** — Option A data-model split: employment now lives on the
  membership, so a café owner can only edit a person's terms in their own café. Owner "disable"
  maps to per-café `employment_active`, not the global account. PIN reset restricted to
  single-café users and bumps `token_version` (`admin/users/[id]/route.ts`, `reset-pin`).
- **Session revocation / stale access** — `requireTenantUser` now rechecks `profiles.is_active`,
  `employment_active`, membership + café status, and `token_version` live on every request;
  `requireSuperAdmin` trusts the DB role, not the JWT (`src/lib/auth.ts`).
- **Attachment SSRF / stored XSS** — attachment URLs validated for https + exact Blob host +
  own-cert path on write (all leave types); stream endpoint re-validates host, forces
  `Content-Disposition: attachment` + `nosniff` + a path-derived type allowlist
  (`src/lib/storage.ts`, `leave-requests/[id]/attachment/route.ts`).
- **Telegram hijack** — removed phone-based `/link`; new session-gated `POST /api/telegram-link`
  mints a single-use code consumed atomically by the webhook, private-chat only. UI:
  `TelegramLinkButton` on the leave page.

### Other fixes
- Impersonation reversibility — new `POST /api/auth/stop-impersonating` reconstructs the admin
  session from `impersonator_id` after re-checking DB super-admin status; disabled users can no
  longer be impersonated; impersonation token capped at 1h.
- Super-admin sign-out now POSTs (was a GET returning 405).
- `APP_BASE_URL` — removed the wrong `cafeos.app` default; resolved at call time, throws in prod
  if unset.
- Payroll integrity — `total_hours` derived server-side (no client trust); `entry_date` must fall
  in the timesheet month; entry writes lock the parent timesheet and re-check status in-tx.
- Offboarding — staff removal soft-suspends the membership (preserves pay/leave history) instead
  of hard-deleting it.

### Decisions
- **Option A over guard-only** for the employment data model — moving fields to the membership
  fixes the takeover at the root rather than bolting on authorization checks that the global PIN
  would still defeat.
- **PIN reset: single-café restriction** over a must-change-PIN flow — since the PIN is a global
  credential, blocking owners from resetting multi-café users' PINs actually closes the
  cross-café hijack, which must-change alone would not.
- **Impersonation: reconstruct from `impersonator_id`** over stashing the admin token — re-checks
  the live DB role instead of restoring stale privilege.

### Remaining (tracked in tasks/todo.md)
Phase 3 tail (approve/reject serialization, signature bounds, client autosave ordering),
Phase 4 (billing/onboarding atomicity), Phase 5 (notification reliability + profile privacy),
Phase 6 (PWA icons/service worker, a11y, product bugs, security headers, repo health).

## 2026-05-04 — Multi-tenant Rewrite "Mighty Creek" (Phases A–H)

### Summary
Full multi-tenant conversion of CafeOS. Multiple independent cafes can now share the same deployment with complete data isolation, self-serve onboarding, and a super admin control plane.

### Schema changes (run on Neon before deploying app)
- `db/migrations/2026-05-04-multitenant-additive.sql` — additive migration: new `cafes` + `cafe_memberships` tables, `cafe_id` on all business tables (backfilled from seeded Main Cafe), `is_super_admin` on profiles, `impersonator_id` on audit_log, GUC helper, updated audit triggers, composite indexes
- `db/bootstrap-super-admin.sql` — one-time script to promote a profile to super admin

### Phase H migrations (run ≥1 week after prod soak)
- `db/migrations/2026-05-04-drop-profile-role.sql` — drops `profiles.role` column
- `db/migrations/2026-05-04-tripwire-triggers.sql` — installs `assert_cafe_match()` BEFORE INSERT/UPDATE on 6 tables

### New files
- `src/lib/cafeContext.ts` — server-side `getActiveCafe()` helper
- `src/app/c/[slug]/layout.tsx` — per-cafe server layout with metadata + impersonation banner
- `src/app/c/[slug]/manifest.json/route.ts` — dynamic per-cafe PWA manifest
- `src/app/login/select/page.tsx` — multi-membership cafe picker
- `src/app/start/page.tsx` + `src/app/api/start/route.ts` — self-serve cafe onboarding with IP rate limiting
- `src/app/super/layout.tsx`, `page.tsx`, `cafes/[id]/page.tsx`, `admins/page.tsx` — super admin UI
- `src/app/api/super/cafes/route.ts`, `[id]/route.ts`, `[id]/approve/route.ts`, `[id]/suspend/route.ts`, `[id]/impersonate/route.ts` — super admin APIs
- `src/app/api/super/admins/route.ts` — super admin grant/revoke
- `src/app/api/auth/select-cafe/route.ts`, `switch-cafe/route.ts` — multi-cafe session management

### Modified files
- `src/lib/auth.ts` — JWT carries cafe_id/slug/role/is_super_admin/impersonator_id; `requireTenantUser()` / `requireSuperAdmin()` / `requireManagerInCafe()` / `requireOwnerInCafe()`; `profiles.role` removed from SELECT
- `src/lib/db.ts` — `withTenantTx()` with parameterised GUC set_config
- `src/lib/validators.ts` — `MembershipRole` primary, `Role` backward-compat alias
- `src/lib/notifications.ts` — all queries scope through cafe_memberships; `APP_BASE_URL` env var; `notifyCafeSignup` added
- `src/lib/storage.ts` — `cafeId` required; path `medical-certificates/{cafeId}/{userId}/...`
- `src/middleware.ts` — slug-vs-JWT enforcement, legacy redirect block removed (Phase H)
- `src/context/AuthContext.tsx` — active_cafe, memberships, switchCafe()
- `src/app/layout.tsx` — generic platform metadata
- `src/app/login/page.tsx` — "Apply for access" link to /start
- `src/app/api/auth/login/route.ts`, `me/route.ts` — multi-membership aware
- All routes under `src/app/c/[slug]/...` — moved from flat paths; all queries gain `AND cafe_id = ctx.cafeId`
- All API routes — `requireTenantUser()`, `cafe_id` in every query/insert, `withTenantTx()`
- `src/app/api/leave-requests/route.ts` + `[id]/route.ts` — JOIN cafe_memberships for role
- `src/app/api/timesheets/route.ts` + `[id]/route.ts` — JOIN cafe_memberships for role
- `src/app/api/admin/users/route.ts` — removed `role` from INSERT INTO profiles

### New env var required
- `APP_BASE_URL` — public base URL (e.g. `https://cafeos.app`)

### Known open item
- Medical cert download route: old blobs (pre-Phase E) use 2-segment paths and will fail `ownerFromPath` ownership check. Needs blob migration or backward-compat handling before Phase H migration.
