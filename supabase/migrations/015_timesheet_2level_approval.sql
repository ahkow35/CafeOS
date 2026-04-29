-- Migration: 2-level timesheet approval (manager → owner)
-- Workflow: draft → submitted → pending_owner → approved
--           rejected can occur from submitted (manager or owner) or pending_owner (owner only)
--
-- NOTE: app DB is Neon (Vercel Postgres). No Supabase auth/RLS — access control
-- lives in the Next.js API layer (src/lib/auth.ts + route handlers). The
-- supabase/migrations/ folder is kept as a historical naming convention only.

-- 1. Allow the new 'pending_owner' status
ALTER TABLE public.timesheets
  DROP CONSTRAINT IF EXISTS timesheets_status_check;
ALTER TABLE public.timesheets
  ADD CONSTRAINT timesheets_status_check
  CHECK (status IN ('draft', 'submitted', 'pending_owner', 'approved', 'rejected'));

-- 2. Track who manager-approved (forwarded to owner). Mirrors leave_requests.
ALTER TABLE public.timesheets
  ADD COLUMN IF NOT EXISTS manager_action_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS manager_action_at TIMESTAMPTZ;
