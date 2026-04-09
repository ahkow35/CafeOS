-- Fix: the old policy's implicit WITH CHECK blocked status transitions
-- from draft → submitted (the resulting row no longer matched status = 'draft').
-- Replace with an explicit WITH CHECK that permits draft and submitted.

DROP POLICY IF EXISTS "Part timers update own draft timesheets" ON public.timesheets;

CREATE POLICY "Users update own timesheets" ON public.timesheets
  FOR UPDATE
  USING (auth.uid() = user_id AND status = 'draft')
  WITH CHECK (auth.uid() = user_id AND status IN ('draft', 'submitted'));
