-- db/migrations/2026-05-09-billing.sql
-- Adds Stripe billing columns to cafes.

BEGIN;

ALTER TABLE public.cafes
  ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id  TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS trial_ends_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_status     TEXT;

COMMIT;
