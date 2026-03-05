-- CafeOS Database Replication Script
-- Run this in the Supabase SQL Editor of your NEW project.

-- ==========================================
-- 1. EXTENSIONS
-- ==========================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- 2. TABLES
-- ==========================================

-- PROFILES (Matches 'users' in migrations, renaming to 'profiles' to match app code)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT NOT NULL,
    full_name TEXT NOT NULL, -- Renamed from 'name' to 'full_name' to match typical Supabase patterns if needed, or keeping as 'name' based on app usage. 
    -- Application code uses `profile.full_name`? Let's check database.types.ts: it has `full_name`.
    -- Migration 001 had `name`. I will use `full_name` to match database.types.ts.
    role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('staff', 'manager', 'owner')),
    annual_leave_balance INTEGER NOT NULL DEFAULT 14,
    medical_leave_balance INTEGER NOT NULL DEFAULT 14,
    is_active BOOLEAN DEFAULT true, -- Added based on database.types.ts
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- LEAVE REQUESTS
CREATE TABLE IF NOT EXISTS public.leave_requests (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    leave_type TEXT NOT NULL CHECK (leave_type IN ('annual', 'medical')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    days_requested INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_manager' 
        CHECK (status IN ('pending_manager', 'pending_owner', 'approved', 'rejected')),
    reason TEXT, -- From database.types.ts
    attachment_url TEXT, -- From database.types.ts
    -- Manager action tracking
    manager_action_by UUID REFERENCES auth.users(id),
    manager_action_at TIMESTAMPTZ,
    -- Owner action tracking
    owner_action_by UUID REFERENCES auth.users(id),
    owner_action_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TASKS
CREATE TABLE IF NOT EXISTS public.tasks (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    deadline TIMESTAMPTZ NOT NULL,
    assigned_to TEXT NOT NULL DEFAULT 'all', -- 'all' or user UUID
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
    created_by UUID NOT NULL REFERENCES auth.users(id),
    completed_by UUID REFERENCES auth.users(id),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- 3. FUNCTIONS & TRIGGERS
-- ==========================================

-- Helper: Check if user is manager or owner
CREATE OR REPLACE FUNCTION public.is_manager_or_owner()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role IN ('manager', 'owner')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper: Check if user is owner
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'owner'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: Update updated_at column
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leave_requests_updated_at
    BEFORE UPDATE ON public.leave_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at();

-- Trigger: Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, role)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'role', 'staff')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- ==========================================
-- 4. ROW LEVEL SECURITY (RLS)
-- ==========================================

-- PROFILES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Managers and owners can view all profiles" ON public.profiles
    FOR SELECT USING (public.is_manager_or_owner());

CREATE POLICY "Owners can update all profiles" ON public.profiles
    FOR UPDATE USING (public.is_owner());

-- LEAVE REQUESTS
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own requests" ON public.leave_requests
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own requests" ON public.leave_requests
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Managers and owners can view all requests" ON public.leave_requests
    FOR SELECT USING (public.is_manager_or_owner());

CREATE POLICY "Managers and owners can update requests" ON public.leave_requests
    FOR UPDATE USING (public.is_manager_or_owner());

-- TASKS
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view assigned tasks" ON public.tasks
    FOR SELECT USING (
        assigned_to = 'all' OR 
        assigned_to = auth.uid()::text OR 
        public.is_manager_or_owner()
    );

CREATE POLICY "Anyone can update tasks they can see" ON public.tasks
    FOR UPDATE USING (
        assigned_to = 'all' OR 
        assigned_to = auth.uid()::text OR 
        public.is_manager_or_owner()
    );

CREATE POLICY "Managers and owners can create tasks" ON public.tasks
    FOR INSERT WITH CHECK (public.is_manager_or_owner());

-- ==========================================
-- 5. STORAGE
-- ==========================================

-- Create 'medical_certificates' bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('medical_certificates', 'medical_certificates', true)
ON CONFLICT (id) DO NOTHING;

-- Storage Policies
DROP POLICY IF EXISTS "Authenticated users can upload MCs" ON storage.objects;
CREATE POLICY "Authenticated users can upload MCs" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'medical_certificates');

DROP POLICY IF EXISTS "Authenticated users can view MCs" ON storage.objects;
CREATE POLICY "Authenticated users can view MCs" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'medical_certificates');

DROP POLICY IF EXISTS "Users can update own MCs" ON storage.objects;
CREATE POLICY "Users can update own MCs" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'medical_certificates' AND auth.uid() = owner);

DROP POLICY IF EXISTS "Users can delete own MCs" ON storage.objects;
CREATE POLICY "Users can delete own MCs" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'medical_certificates' AND auth.uid() = owner);
