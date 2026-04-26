-- Tighten RLS gaps found during production audit (2026-04-16).
-- Three fixes:
--   1. Timesheets: block employees from writing approval/signature columns.
--   2. Tasks: restrict staff to only updating status/completion fields.
--   3. Profiles: block self-service writes to sensitive columns.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. TIMESHEETS — protect approval & manager-signature columns
-- ═══════════════════════════════════════════════════════════════════════
-- The UPDATE policy lets the employee write any column when the row is
-- draft or rejected. A BEFORE UPDATE trigger rejects changes to columns
-- that only managers/owners should touch.

CREATE OR REPLACE FUNCTION public.guard_timesheet_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT public.is_manager_or_owner() THEN
    IF NEW.approved_by        IS DISTINCT FROM OLD.approved_by
    OR NEW.approved_at        IS DISTINCT FROM OLD.approved_at
    OR NEW.manager_signature  IS DISTINCT FROM OLD.manager_signature
    OR NEW.rejection_reason   IS DISTINCT FROM OLD.rejection_reason
    THEN
      RAISE EXCEPTION 'Only managers or owners may modify approval fields';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS guard_timesheet_cols ON public.timesheets;
CREATE TRIGGER guard_timesheet_cols
  BEFORE UPDATE ON public.timesheets
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_timesheet_columns();

-- ═══════════════════════════════════════════════════════════════════════
-- 2. TASKS — staff can only toggle status & completion fields
-- ═══════════════════════════════════════════════════════════════════════
-- Replace the wide-open update policy with a simple USING-only policy
-- for assignees, plus a trigger that blocks metadata changes by non-managers.

DROP POLICY IF EXISTS "Anyone can update tasks they can see" ON public.tasks;

CREATE POLICY "Assignees can complete tasks" ON public.tasks
  FOR UPDATE
  USING (
    assigned_to = 'all'
    OR assigned_to = auth.uid()::text
  );

-- Managers/owners: full update
CREATE POLICY "Managers and owners can update any task" ON public.tasks
  FOR UPDATE USING (public.is_manager_or_owner());

-- Trigger blocks non-managers from changing task metadata
CREATE OR REPLACE FUNCTION public.guard_task_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT public.is_manager_or_owner() THEN
    IF NEW.title       IS DISTINCT FROM OLD.title
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.deadline    IS DISTINCT FROM OLD.deadline
    OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
    OR NEW.created_by  IS DISTINCT FROM OLD.created_by
    THEN
      RAISE EXCEPTION 'Only managers or owners may modify task details';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS guard_task_cols ON public.tasks;
CREATE TRIGGER guard_task_cols
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_task_columns();

-- ═══════════════════════════════════════════════════════════════════════
-- 3. PROFILES — block self-service writes to sensitive columns
-- ═══════════════════════════════════════════════════════════════════════
-- Staff should not be able to change their own role, hourly_rate,
-- leave balances, or is_active flag.

CREATE OR REPLACE FUNCTION public.guard_profile_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT public.is_owner() THEN
    IF NEW.role                   IS DISTINCT FROM OLD.role
    OR NEW.hourly_rate            IS DISTINCT FROM OLD.hourly_rate
    OR NEW.is_active              IS DISTINCT FROM OLD.is_active
    OR NEW.annual_leave_balance   IS DISTINCT FROM OLD.annual_leave_balance
    OR NEW.medical_leave_balance  IS DISTINCT FROM OLD.medical_leave_balance
    THEN
      RAISE EXCEPTION 'Only owners may modify role, rate, active status, or leave balances';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS guard_profile_cols ON public.profiles;
CREATE TRIGGER guard_profile_cols
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_columns();
