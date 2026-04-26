-- Audit log for payroll-adjacent actions (timesheets, leave, profiles).
-- Records who did what, when, and what changed.

CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  actor_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL,        -- 'approve', 'reject', 'create', 'update', 'delete'
  entity TEXT NOT NULL,        -- 'timesheet', 'leave_request', 'profile', 'task'
  entity_id UUID NOT NULL,
  diff JSONB,                  -- { field: [old, new], ... } or null for create/delete
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_entity ON public.audit_log(entity, entity_id);
CREATE INDEX idx_audit_log_actor ON public.audit_log(actor_id);
CREATE INDEX idx_audit_log_created ON public.audit_log(created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Only managers/owners can read the audit log
CREATE POLICY "Managers and owners can view audit log" ON public.audit_log
  FOR SELECT USING (public.is_manager_or_owner());

-- Insert allowed for authenticated users (triggers run as the acting user)
CREATE POLICY "Authenticated users can insert audit entries" ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = actor_id);

-- ── Auto-log timesheet status changes ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_timesheet_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.audit_log (actor_id, action, entity, entity_id, diff)
    VALUES (
      auth.uid(),
      CASE NEW.status
        WHEN 'approved' THEN 'approve'
        WHEN 'rejected' THEN 'reject'
        WHEN 'submitted' THEN 'submit'
        ELSE 'update'
      END,
      'timesheet',
      NEW.id,
      jsonb_build_object('status', jsonb_build_array(OLD.status, NEW.status))
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS audit_timesheet_change ON public.timesheets;
CREATE TRIGGER audit_timesheet_change
  AFTER UPDATE ON public.timesheets
  FOR EACH ROW
  EXECUTE FUNCTION public.log_timesheet_change();

-- ── Auto-log leave request status changes ────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_leave_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.audit_log (actor_id, action, entity, entity_id, diff)
    VALUES (
      auth.uid(),
      CASE NEW.status
        WHEN 'approved' THEN 'approve'
        WHEN 'rejected' THEN 'reject'
        ELSE 'update'
      END,
      'leave_request',
      NEW.id,
      jsonb_build_object('status', jsonb_build_array(OLD.status, NEW.status))
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS audit_leave_change ON public.leave_requests;
CREATE TRIGGER audit_leave_change
  AFTER UPDATE ON public.leave_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.log_leave_change();
