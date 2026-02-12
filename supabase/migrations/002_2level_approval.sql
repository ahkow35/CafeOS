-- Migration Script: 2-Level Approval Workflow
-- Run this in Supabase SQL Editor if you already have the old schema

-- 1. Update role constraint on users table
ALTER TABLE public.users 
  DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users 
  ADD CONSTRAINT users_role_check 
  CHECK (role IN ('staff', 'manager', 'owner'));

-- 2. Add new columns to leave_requests for tracking approvals
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS manager_action_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS manager_action_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS owner_action_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS owner_action_at TIMESTAMPTZ;

-- 3. Update status constraint
ALTER TABLE public.leave_requests 
  DROP CONSTRAINT IF EXISTS leave_requests_status_check;
ALTER TABLE public.leave_requests 
  ADD CONSTRAINT leave_requests_status_check 
  CHECK (status IN ('pending_manager', 'pending_owner', 'approved', 'rejected'));

-- 4. Migrate existing pending requests to new status
UPDATE public.leave_requests 
  SET status = 'pending_manager' 
  WHERE status = 'pending';

-- 5. Rename old approved_by column if it exists (for backward compatibility)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'leave_requests' AND column_name = 'approved_by') THEN
    -- Copy data to owner_action_by for approved requests
    UPDATE public.leave_requests 
      SET owner_action_by = approved_by, owner_action_at = updated_at
      WHERE status = 'approved' AND approved_by IS NOT NULL;
    
    -- Drop the old column
    ALTER TABLE public.leave_requests DROP COLUMN approved_by;
  END IF;
END $$;

-- 6. Add helper function for manager/owner check
CREATE OR REPLACE FUNCTION public.is_manager_or_owner()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role IN ('manager', 'owner')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Add helper function for owner check
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role = 'owner'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Update RLS policies for leave_requests
DROP POLICY IF EXISTS "Admins can view all requests" ON public.leave_requests;
DROP POLICY IF EXISTS "Admins can update requests" ON public.leave_requests;

CREATE POLICY "Managers and owners can view all requests" ON public.leave_requests
    FOR SELECT USING (public.is_manager_or_owner());

CREATE POLICY "Managers and owners can update requests" ON public.leave_requests
    FOR UPDATE USING (public.is_manager_or_owner());

-- Done! Your database now supports 2-level approval workflow
