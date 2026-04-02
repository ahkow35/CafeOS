-- Migration 006: Retrospective Leave Support
-- Adds is_retrospective flag to leave_requests.
-- Existing rows default to false (all prior requests were forward-looking).

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS is_retrospective boolean NOT NULL DEFAULT false;
