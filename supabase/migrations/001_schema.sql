-- CafeOS Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================
-- USERS TABLE
-- =====================
CREATE TABLE IF NOT EXISTS public.users (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('staff', 'manager', 'owner')),
    annual_leave_balance INTEGER NOT NULL DEFAULT 14,
    medical_leave_balance INTEGER NOT NULL DEFAULT 14,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS for users
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.users
    FOR UPDATE USING (auth.uid() = id);

-- Helper function to check if user is manager or owner
CREATE OR REPLACE FUNCTION public.is_manager_or_owner()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role IN ('manager', 'owner')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to check if user is owner
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role = 'owner'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE POLICY "Managers and owners can view all users" ON public.users
    FOR SELECT USING (public.is_manager_or_owner());

CREATE POLICY "Owners can update all users" ON public.users
    FOR UPDATE USING (public.is_owner());

-- =====================
-- LEAVE REQUESTS TABLE
-- =====================
CREATE TABLE IF NOT EXISTS public.leave_requests (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    leave_type TEXT NOT NULL CHECK (leave_type IN ('annual', 'medical')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    days_requested INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_manager' 
        CHECK (status IN ('pending_manager', 'pending_owner', 'approved', 'rejected')),
    -- Manager action tracking
    manager_action_by UUID REFERENCES auth.users(id),
    manager_action_at TIMESTAMPTZ,
    -- Owner action tracking
    owner_action_by UUID REFERENCES auth.users(id),
    owner_action_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS for leave_requests
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own requests" ON public.leave_requests
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own requests" ON public.leave_requests
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Managers and owners can view all requests" ON public.leave_requests
    FOR SELECT USING (public.is_manager_or_owner());

CREATE POLICY "Managers and owners can update requests" ON public.leave_requests
    FOR UPDATE USING (public.is_manager_or_owner());

-- Updated_at trigger
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

-- =====================
-- TASKS TABLE
-- =====================
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

-- RLS for tasks
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

-- =====================
-- AUTO-CREATE USER PROFILE
-- =====================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, email, name, role)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'role', 'staff')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for new user creation
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();
