# Changelog

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
