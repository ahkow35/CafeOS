-- Migration: Part-timer role + Timesheet feature
-- Run in Supabase SQL Editor

-- 1. Add part_timer to role constraint
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('staff', 'manager', 'owner', 'part_timer'));

-- 2. Add phone and hourly_rate to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10,2);

-- 3. Create timesheets table
CREATE TABLE IF NOT EXISTS public.timesheets (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  month_year TEXT NOT NULL, -- 'YYYY-MM'
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  comments TEXT,
  rejection_reason TEXT,
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, month_year)
);

-- 4. Create timesheet_entries table
CREATE TABLE IF NOT EXISTS public.timesheet_entries (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  timesheet_id UUID NOT NULL REFERENCES public.timesheets(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  break_hours NUMERIC(4,2) NOT NULL DEFAULT 0,
  total_hours NUMERIC(4,2) NOT NULL DEFAULT 0,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(timesheet_id, entry_date)
);

-- 5. updated_at trigger for timesheets
CREATE TRIGGER timesheets_updated_at
  BEFORE UPDATE ON public.timesheets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- 6. RLS
ALTER TABLE public.timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheet_entries ENABLE ROW LEVEL SECURITY;

-- Part timers: view and manage their own
CREATE POLICY "Part timers view own timesheets" ON public.timesheets
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Part timers create own timesheets" ON public.timesheets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Part timers update own draft timesheets" ON public.timesheets
  FOR UPDATE USING (auth.uid() = user_id AND status = 'draft');

-- Managers/owners: view and update all
CREATE POLICY "Managers and owners view all timesheets" ON public.timesheets
  FOR SELECT USING (public.is_manager_or_owner());

CREATE POLICY "Managers and owners update timesheets" ON public.timesheets
  FOR UPDATE USING (public.is_manager_or_owner());

-- Timesheet entries: part timer manages own (only while draft)
CREATE POLICY "Users view own entries" ON public.timesheet_entries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.timesheets
      WHERE id = timesheet_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users insert own draft entries" ON public.timesheet_entries
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.timesheets
      WHERE id = timesheet_id AND user_id = auth.uid() AND status = 'draft'
    )
  );

CREATE POLICY "Users update own draft entries" ON public.timesheet_entries
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.timesheets
      WHERE id = timesheet_id AND user_id = auth.uid() AND status = 'draft'
    )
  );

CREATE POLICY "Users delete own draft entries" ON public.timesheet_entries
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.timesheets
      WHERE id = timesheet_id AND user_id = auth.uid() AND status = 'draft'
    )
  );

-- Managers/owners: view all entries
CREATE POLICY "Managers and owners view all entries" ON public.timesheet_entries
  FOR SELECT USING (public.is_manager_or_owner());
