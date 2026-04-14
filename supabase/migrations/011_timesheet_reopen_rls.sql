-- Fix: the timesheets UPDATE policy's USING clause required status = 'draft',
-- which blocked the reopen-to-edit flow (rejected → draft) and the
-- subsequent resubmit (the row was stuck at 'rejected' in the DB even
-- though the UI optimistically showed 'submitted'). As a result, admins
-- never saw resubmitted timesheets on their dashboard.
--
-- Allow the part-timer to update their own timesheet when it's in either
-- 'draft' or 'rejected' state. The WITH CHECK still limits what the row
-- can transition to — draft or submitted only.

DROP POLICY IF EXISTS "Users update own timesheets" ON public.timesheets;

CREATE POLICY "Users update own timesheets" ON public.timesheets
  FOR UPDATE
  USING (auth.uid() = user_id AND status IN ('draft', 'rejected'))
  WITH CHECK (auth.uid() = user_id AND status IN ('draft', 'submitted'));
