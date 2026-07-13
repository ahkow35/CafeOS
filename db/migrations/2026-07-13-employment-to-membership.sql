-- Phase 1 (Option A): move café-specific employment data off the global identity.
--
-- Root cause of the cross-tenant takeover findings: job_title, leave balances,
-- hourly_rate and the employment "active" flag lived on `profiles` (one global
-- row per person), so a café owner editing them changed the person everywhere.
-- This migration relocates those fields to `cafe_memberships` (one row per
-- person-per-café) and adds a session-revocation counter to `profiles`.
--
-- ADDITIVE + IDEMPOTENT: safe to apply BEFORE the new app code rolls out. The
-- legacy `profiles` columns are LEFT IN PLACE (deprecated) and dropped in a
-- later phase after prod soak. Backfill only fills membership rows from the
-- current profile values.
--
-- Apply:  psql "$POSTGRES_URL_NON_POOLING" -f db/migrations/2026-07-13-employment-to-membership.sql

BEGIN;

-- ── cafe_memberships: café-scoped employment fields ──────────────────────────
ALTER TABLE public.cafe_memberships
  ADD COLUMN IF NOT EXISTS job_title             TEXT,
  ADD COLUMN IF NOT EXISTS annual_leave_balance  INTEGER      NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS medical_leave_balance INTEGER      NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS hourly_rate           NUMERIC(10,2),
  -- Per-café employment switch. Distinct from `status` (membership lifecycle:
  -- pending/active/suspended) and from profiles.is_active (global account).
  -- A disabled employee stays visible in the roster but cannot act in this café.
  ADD COLUMN IF NOT EXISTS employment_active     BOOLEAN      NOT NULL DEFAULT TRUE;

-- Backfill each membership from its member's current profile values.
-- Runs once; on re-run it simply re-copies the same values (harmless).
UPDATE public.cafe_memberships m
   SET job_title             = p.job_title,
       annual_leave_balance  = p.annual_leave_balance,
       medical_leave_balance = p.medical_leave_balance,
       hourly_rate           = p.hourly_rate,
       employment_active     = p.is_active
  FROM public.profiles p
 WHERE p.id = m.user_id;

-- ── profiles: session revocation counter ─────────────────────────────────────
-- Bumped on PIN reset and global account disable so JWTs issued earlier are
-- rejected on their next request instead of surviving until 7-day expiry.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

COMMIT;

-- NOTE (deprecated, dropped in a later phase after soak):
--   profiles.job_title, profiles.annual_leave_balance, profiles.medical_leave_balance,
--   profiles.hourly_rate are now superseded by the cafe_memberships columns above.
--   profiles.is_active REMAINS the global account flag (not deprecated).
