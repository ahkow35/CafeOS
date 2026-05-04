-- Phase H: Drop profiles.role column (now superseded by cafe_memberships.role).
-- Run only after app is fully deployed and confirmed working on the multi-tenant schema.
-- Safe to run on Neon via psql or the Neon console.

BEGIN;

ALTER TABLE profiles DROP COLUMN IF EXISTS role;

-- Remove the legacy index on profiles.role if it still exists.
DROP INDEX IF EXISTS idx_profiles_role;

COMMIT;
