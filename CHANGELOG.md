# Changelog

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
