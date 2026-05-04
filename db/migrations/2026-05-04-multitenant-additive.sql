-- Mighty Creek: multi-tenant migration (Phase A — additive only).
--
-- This migration is safe to apply BEFORE the new app code rolls out:
--   * Adds `cafes`, `cafe_memberships`, `is_super_admin`.
--   * Adds nullable `cafe_id` to all business tables, backfills from a single
--     seeded cafe, then locks NOT NULL.
--   * Backfills `cafe_memberships` rows from the legacy `profiles.role`.
--   * Updates audit triggers to stamp `cafe_id` (using NEW.cafe_id — always
--     populated and independent of any session GUC, so audit works even on
--     super-admin maintenance paths).
--   * Adds `impersonator_id` to audit_log so super-admin "view as" actions are
--     traceable to both the impersonated user and the impersonator.
--
-- The legacy `profiles.role` column stays in place; Phase H drops it once the
-- new app has soaked in prod for ≥1 week.
--
-- Override the seeded cafe at apply time:
--     psql ... -c "SET app.seed_cafe_slug='mighty-creek'; \
--                  SET app.seed_cafe_name='Mighty Creek'; \
--                  \i db/migrations/2026-05-04-multitenant-additive.sql"
-- Defaults are 'main' / 'Main Cafe' if not set.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. cafes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cafes (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    logo_url    TEXT,
    status      TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'active', 'suspended')),
    created_by  UUID REFERENCES public.profiles(id),
    approved_by UUID REFERENCES public.profiles(id),
    approved_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT cafes_slug_format
      CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$'),
    CONSTRAINT cafes_slug_reserved
      CHECK (slug NOT IN (
        'super', 'api', 'c', 'login', 'start', 'admin',
        '_next', 'public', 'manifest', 'favicon', 'icons'
      ))
);

DROP TRIGGER IF EXISTS cafes_updated_at ON public.cafes;
CREATE TRIGGER cafes_updated_at
    BEFORE UPDATE ON public.cafes
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. cafe_memberships  (one phone = one profile = many cafes, role per cafe)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cafe_memberships (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cafe_id    UUID NOT NULL REFERENCES public.cafes(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('staff', 'manager', 'owner', 'part_timer')),
    status     TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('pending', 'active', 'suspended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (cafe_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON public.cafe_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_cafe ON public.cafe_memberships(cafe_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. profiles.is_super_admin
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Seed the existing single cafe (idempotent on slug)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.cafes (slug, name, status)
VALUES (
    COALESCE(NULLIF(current_setting('app.seed_cafe_slug', TRUE), ''), 'main'),
    COALESCE(NULLIF(current_setting('app.seed_cafe_name', TRUE), ''), 'Main Cafe'),
    'active'
)
ON CONFLICT (slug) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Add nullable cafe_id on business tables
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.leave_requests
    ADD COLUMN IF NOT EXISTS cafe_id UUID REFERENCES public.cafes(id);
ALTER TABLE public.timesheets
    ADD COLUMN IF NOT EXISTS cafe_id UUID REFERENCES public.cafes(id);
ALTER TABLE public.timesheet_entries
    ADD COLUMN IF NOT EXISTS cafe_id UUID REFERENCES public.cafes(id);
ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS cafe_id UUID REFERENCES public.cafes(id);
ALTER TABLE public.audit_log
    ADD COLUMN IF NOT EXISTS cafe_id UUID REFERENCES public.cafes(id);
ALTER TABLE public.audit_log
    ADD COLUMN IF NOT EXISTS impersonator_id UUID REFERENCES public.profiles(id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Backfill cafe_id from the oldest cafe (i.e. the seeded one above on a
--    fresh single-tenant database)
-- ─────────────────────────────────────────────────────────────────────────────
WITH seed AS (SELECT id FROM public.cafes ORDER BY created_at ASC LIMIT 1)
UPDATE public.leave_requests    SET cafe_id = (SELECT id FROM seed) WHERE cafe_id IS NULL;
WITH seed AS (SELECT id FROM public.cafes ORDER BY created_at ASC LIMIT 1)
UPDATE public.timesheets        SET cafe_id = (SELECT id FROM seed) WHERE cafe_id IS NULL;
WITH seed AS (SELECT id FROM public.cafes ORDER BY created_at ASC LIMIT 1)
UPDATE public.timesheet_entries SET cafe_id = (SELECT id FROM seed) WHERE cafe_id IS NULL;
WITH seed AS (SELECT id FROM public.cafes ORDER BY created_at ASC LIMIT 1)
UPDATE public.tasks             SET cafe_id = (SELECT id FROM seed) WHERE cafe_id IS NULL;
WITH seed AS (SELECT id FROM public.cafes ORDER BY created_at ASC LIMIT 1)
UPDATE public.audit_log         SET cafe_id = (SELECT id FROM seed) WHERE cafe_id IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Backfill cafe_memberships from profiles.role
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.cafe_memberships (cafe_id, user_id, role, status)
SELECT
    (SELECT id FROM public.cafes ORDER BY created_at ASC LIMIT 1),
    p.id,
    p.role,
    CASE WHEN p.is_active THEN 'active' ELSE 'suspended' END
FROM public.profiles p
ON CONFLICT (cafe_id, user_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Verify backfill, then lock NOT NULL on the 4 business tables
--    (audit_log stays nullable — system/super-admin writes may have no cafe)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.leave_requests    WHERE cafe_id IS NULL) THEN
        RAISE EXCEPTION 'leave_requests still has NULL cafe_id rows; backfill failed';
    END IF;
    IF EXISTS (SELECT 1 FROM public.timesheets        WHERE cafe_id IS NULL) THEN
        RAISE EXCEPTION 'timesheets still has NULL cafe_id rows; backfill failed';
    END IF;
    IF EXISTS (SELECT 1 FROM public.timesheet_entries WHERE cafe_id IS NULL) THEN
        RAISE EXCEPTION 'timesheet_entries still has NULL cafe_id rows; backfill failed';
    END IF;
    IF EXISTS (SELECT 1 FROM public.tasks             WHERE cafe_id IS NULL) THEN
        RAISE EXCEPTION 'tasks still has NULL cafe_id rows; backfill failed';
    END IF;
END $$;

ALTER TABLE public.leave_requests    ALTER COLUMN cafe_id SET NOT NULL;
ALTER TABLE public.timesheets        ALTER COLUMN cafe_id SET NOT NULL;
ALTER TABLE public.timesheet_entries ALTER COLUMN cafe_id SET NOT NULL;
ALTER TABLE public.tasks             ALTER COLUMN cafe_id SET NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Composite indexes for the common (cafe_id, ...) lookup paths
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_leave_cafe_user        ON public.leave_requests(cafe_id, user_id);
CREATE INDEX IF NOT EXISTS idx_leave_cafe_status      ON public.leave_requests(cafe_id, status);
CREATE INDEX IF NOT EXISTS idx_timesheets_cafe_user   ON public.timesheets(cafe_id, user_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_cafe_status ON public.timesheets(cafe_id, status);
CREATE INDEX IF NOT EXISTS idx_entries_cafe           ON public.timesheet_entries(cafe_id);
CREATE INDEX IF NOT EXISTS idx_tasks_cafe_status      ON public.tasks(cafe_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_cafe_assigned    ON public.tasks(cafe_id, assigned_to);
CREATE INDEX IF NOT EXISTS idx_audit_cafe             ON public.audit_log(cafe_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. The role-only partial index is about to lose meaning (role moves to
--     cafe_memberships in Phase H); drop it now to avoid stale plans.
-- ─────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_profiles_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. current_cafe_id() helper — parallel to current_actor_id().
--     Used by Phase H's tripwire triggers; defined here so the function exists
--     in both deploy windows.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_cafe_id()
RETURNS UUID AS $$
DECLARE
    v TEXT;
BEGIN
    v := current_setting('app.cafe_id', TRUE);
    IF v IS NULL OR v = '' THEN
        RETURN NULL;
    END IF;
    RETURN v::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. current_impersonator_id() helper — read from the same GUC mechanism.
--     Set by withTenantTx when the JWT carries an impersonator_id claim.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_impersonator_id()
RETURNS UUID AS $$
DECLARE
    v TEXT;
BEGIN
    v := current_setting('app.impersonator_id', TRUE);
    IF v IS NULL OR v = '' THEN
        RETURN NULL;
    END IF;
    RETURN v::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. Rewrite audit triggers to stamp cafe_id + impersonator_id.
--     Note: cafe_id comes from NEW.cafe_id (the audited row's cafe), not from
--     the GUC. Always populated, independent of session, and matches the
--     forensic intent ("this audit entry concerns cafe X").
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_timesheet_change()
RETURNS TRIGGER AS $$
DECLARE
    actor UUID := public.current_actor_id();
BEGIN
    IF actor IS NULL THEN
        RETURN NEW;
    END IF;
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO public.audit_log (actor_id, impersonator_id, cafe_id, action, entity, entity_id, diff)
        VALUES (
            actor,
            public.current_impersonator_id(),
            NEW.cafe_id,
            CASE NEW.status
                WHEN 'approved'  THEN 'approve'
                WHEN 'rejected'  THEN 'reject'
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
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.log_leave_change()
RETURNS TRIGGER AS $$
DECLARE
    actor UUID := public.current_actor_id();
BEGIN
    IF actor IS NULL THEN
        RETURN NEW;
    END IF;
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO public.audit_log (actor_id, impersonator_id, cafe_id, action, entity, entity_id, diff)
        VALUES (
            actor,
            public.current_impersonator_id(),
            NEW.cafe_id,
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
$$ LANGUAGE plpgsql;

COMMIT;
