-- db/migrations/2026-06-06-timesheet-unique-per-cafe.sql
-- Fix: a multi-cafe user could not have a timesheet for the same month in two
-- cafes. The constraint was UNIQUE(user_id, month_year) — global per user —
-- so the second cafe's INSERT hit a DB conflict (surfaced as a 500). The app
-- layer already scopes the duplicate check by cafe_id + user_id + month_year;
-- this aligns the DB constraint with that intent.

BEGIN;

ALTER TABLE public.timesheets
  DROP CONSTRAINT IF EXISTS timesheets_user_id_month_year_key;

ALTER TABLE public.timesheets
  ADD CONSTRAINT timesheets_cafe_user_month_key UNIQUE (cafe_id, user_id, month_year);

COMMIT;
