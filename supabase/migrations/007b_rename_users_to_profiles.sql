-- Rename public.users → public.profiles and column name → full_name.
-- This was applied out-of-band on the live DB but was never captured as a
-- migration, so a fresh project running 001→008 would fail. Inserting it
-- here so the chain replays cleanly.
--
-- The migration is idempotent: if public.profiles already exists (live DB),
-- every statement no-ops or is wrapped in DO blocks.

-- 1. Rename table (no-op if already renamed)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) THEN
    ALTER TABLE public.users RENAME TO profiles;
  END IF;
END $$;

-- 2. Rename column name → full_name (no-op if already renamed)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'name'
  ) THEN
    ALTER TABLE public.profiles RENAME COLUMN name TO full_name;
  END IF;
END $$;

-- 3. Add is_active column (needed before migration 008)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- 4. Re-point the helper functions at the new table name.
--    These are SECURITY DEFINER so they bypass RLS — must reference the
--    correct table.
CREATE OR REPLACE FUNCTION public.is_manager_or_owner()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role IN ('manager', 'owner')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'owner'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Re-create the auto-profile trigger function to use the new table + column.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, role)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name',
                 NEW.raw_user_meta_data->>'name',
                 split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'role', 'staff')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. RLS policies — drop old names, create new ones on public.profiles.
--    Existing policies on a renamed table keep working, but their names
--    still reference "users" which is confusing. Re-create for clarity.

-- Drop old-named policies (ignore if they were already renamed/dropped)
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Managers and owners can view all users" ON public.profiles;
DROP POLICY IF EXISTS "Owners can update all users" ON public.profiles;

-- Re-create with clearer names
CREATE POLICY "Users can view own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Managers and owners can view all profiles" ON public.profiles
    FOR SELECT USING (public.is_manager_or_owner());

CREATE POLICY "Owners can update all profiles" ON public.profiles
    FOR UPDATE USING (public.is_owner());

-- Owner INSERT policy (needed for /api/admin/users upsert via service role,
-- but also useful for the handle_new_user trigger running as SECURITY DEFINER).
-- On the live DB this may already exist; CREATE IF NOT EXISTS is not supported
-- for policies, so drop-then-create.
DROP POLICY IF EXISTS "Owners can insert profiles" ON public.profiles;
CREATE POLICY "Owners can insert profiles" ON public.profiles
    FOR INSERT WITH CHECK (public.is_owner());
