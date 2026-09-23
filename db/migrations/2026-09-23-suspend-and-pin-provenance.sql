-- db/migrations/2026-09-23-suspend-and-pin-provenance.sql
--
-- Fixes two production bugs:
--
-- 1. cafes.admin_suspended_at — a super admin suspension must be sticky: the
--    Stripe webhook (syncSubscription) previously wrote cafes.status from the
--    subscription status unconditionally, so any later billing event silently
--    undid an administrative suspension. Billing may still move a cafe between
--    'active' and 'suspended' on its own (e.g. trial-ends-without-a-card, then
--    the owner adds a card and the same subscription resumes) — but only while
--    admin_suspended_at is NULL. Once a super admin suspends a cafe, billing
--    leaves status alone until a human clears this column.
--
-- 2. profiles.pin_set_at — distinguishes a profile that has never held a real
--    PIN (still the /api/start placeholder) from one that has, so
--    /api/super/cafes/[id]/approve can tell "brand-new applicant" from
--    "existing account" and never overwrite or blindly reactivate someone
--    else's credentials just because their phone number matches a pending
--    cafe application.
--
-- NOTE: nothing today clears admin_suspended_at (no unsuspend route exists
-- yet) — a suspended cafe stays suspended until a human edits the column
-- directly. That is a pre-existing gap (the UI never offered an unsuspend
-- action either), not something this migration introduces.

BEGIN;

ALTER TABLE public.cafes
  ADD COLUMN IF NOT EXISTS admin_suspended_at TIMESTAMPTZ;

-- Conservative backfill: every cafe already suspended in prod is treated as
-- administratively suspended (a human can clear the column if that's wrong).
-- The alternative — leaving it NULL — would let the very next billing event
-- silently reactivate a real administrative suspension, which is the bug.
UPDATE public.cafes
   SET admin_suspended_at = updated_at
 WHERE status = 'suspended'
   AND admin_suspended_at IS NULL;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pin_set_at TIMESTAMPTZ;

-- Backfill: any profile that is currently active, or has ever held a
-- non-pending membership anywhere, has had a real PIN issued at some point.
-- Anything left NULL is exactly the ambiguous case (a never-active profile
-- with no non-pending membership history) — /api/super/cafes/[id]/approve
-- treats that as "eligible for a fresh PIN" only when is_active is also
-- FALSE, and conservatively refuses (case c) if it somehow isn't.
UPDATE public.profiles p
   SET pin_set_at = p.created_at
 WHERE p.pin_set_at IS NULL
   AND (
     p.is_active = TRUE
     OR EXISTS (
       SELECT 1 FROM public.cafe_memberships m
        WHERE m.user_id = p.id AND m.status <> 'pending'
     )
   );

COMMIT;
