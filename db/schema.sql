-- CafeOS schema for Neon (Vercel Postgres)
-- Replaces the Supabase migrations/ chain. Auth is now phone+PIN, app-layer authz, no RLS.
-- Run once on a fresh database. Re-runs are no-op for tables (IF NOT EXISTS) and replace
-- functions/triggers in place.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- PROFILES (auth + profile in one table)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_e164            TEXT UNIQUE NOT NULL,
    full_name             TEXT NOT NULL,
    job_title             TEXT,
    role                  TEXT NOT NULL DEFAULT 'staff'
                              CHECK (role IN ('staff', 'manager', 'owner', 'part_timer')),
    -- ↑ legacy single-tenant role; superseded by cafe_memberships.role.
    --   Kept until Phase H drops it (after ≥1 week prod soak).
    pin_hash              TEXT NOT NULL,
    failed_attempts       INTEGER NOT NULL DEFAULT 0,
    locked_until          TIMESTAMPTZ,
    annual_leave_balance  INTEGER NOT NULL DEFAULT 14,
    medical_leave_balance INTEGER NOT NULL DEFAULT 14,
    hourly_rate           NUMERIC(10,2),
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    email                 TEXT, -- legacy display only; not used for auth
    telegram_chat_id      TEXT UNIQUE, -- bound via /api/telegram/webhook /link command
    is_super_admin        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_phone ON public.profiles(phone_e164);
-- idx_profiles_role intentionally omitted: role lookups go through cafe_memberships now.

-- ─────────────────────────────────────────────────────────────────────────────
-- CAFES (tenants)
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

-- ─────────────────────────────────────────────────────────────────────────────
-- CAFE_MEMBERSHIPS (one phone = one profile = many cafes, role per cafe)
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
-- LEAVE REQUESTS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leave_requests (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cafe_id             UUID NOT NULL REFERENCES public.cafes(id),
    user_id             UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    leave_type          TEXT NOT NULL CHECK (leave_type IN ('annual', 'medical')),
    start_date          DATE NOT NULL,
    end_date            DATE NOT NULL,
    days_requested      INTEGER NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending_manager'
                            CHECK (status IN ('pending_manager', 'pending_owner', 'approved', 'rejected')),
    reason              TEXT,
    attachment_url      TEXT, -- Vercel Blob URL (or null)
    is_retrospective    BOOLEAN NOT NULL DEFAULT FALSE,
    manager_action_by   UUID REFERENCES public.profiles(id),
    manager_action_at   TIMESTAMPTZ,
    owner_action_by     UUID REFERENCES public.profiles(id),
    owner_action_at     TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_user   ON public.leave_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON public.leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_cafe_user       ON public.leave_requests(cafe_id, user_id);
CREATE INDEX IF NOT EXISTS idx_leave_cafe_status     ON public.leave_requests(cafe_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- TASKS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tasks (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cafe_id       UUID NOT NULL REFERENCES public.cafes(id),
    title         TEXT NOT NULL,
    description   TEXT,
    deadline      TIMESTAMPTZ NOT NULL,
    assigned_to   TEXT NOT NULL DEFAULT 'all', -- 'all' (= all in this cafe) or profile UUID as text
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
    created_by    UUID NOT NULL REFERENCES public.profiles(id),
    completed_by  UUID REFERENCES public.profiles(id),
    completed_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned       ON public.tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_status         ON public.tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_cafe_status    ON public.tasks(cafe_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_cafe_assigned  ON public.tasks(cafe_id, assigned_to);

-- ─────────────────────────────────────────────────────────────────────────────
-- TIMESHEETS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.timesheets (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cafe_id             UUID NOT NULL REFERENCES public.cafes(id),
    user_id             UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    month_year          TEXT NOT NULL, -- 'YYYY-MM'
    status              TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'submitted', 'pending_owner', 'approved', 'rejected')),
    comments            TEXT,
    rejection_reason    TEXT,
    employee_signature  TEXT,
    manager_signature   TEXT,
    manager_action_by   UUID REFERENCES public.profiles(id),
    manager_action_at   TIMESTAMPTZ,
    approved_by         UUID REFERENCES public.profiles(id),
    approved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, month_year)
);

CREATE INDEX IF NOT EXISTS idx_timesheets_user        ON public.timesheets(user_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_status      ON public.timesheets(status);
CREATE INDEX IF NOT EXISTS idx_timesheets_cafe_user   ON public.timesheets(cafe_id, user_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_cafe_status ON public.timesheets(cafe_id, status);

CREATE TABLE IF NOT EXISTS public.timesheet_entries (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cafe_id       UUID NOT NULL REFERENCES public.cafes(id),
    timesheet_id  UUID NOT NULL REFERENCES public.timesheets(id) ON DELETE CASCADE,
    entry_date    DATE NOT NULL,
    start_time    TIME,
    end_time      TIME,
    break_hours   NUMERIC(4,2) NOT NULL DEFAULT 0,
    total_hours   NUMERIC(4,2) NOT NULL DEFAULT 0,
    remarks       TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(timesheet_id, entry_date)
);

CREATE INDEX IF NOT EXISTS idx_timesheet_entries_timesheet ON public.timesheet_entries(timesheet_id);
CREATE INDEX IF NOT EXISTS idx_entries_cafe                ON public.timesheet_entries(cafe_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- AUDIT LOG
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id        UUID NOT NULL REFERENCES public.profiles(id),
    impersonator_id UUID REFERENCES public.profiles(id),
    -- ↑ if a super admin "viewed as" another user during this action,
    --   their id lands here so audit reads can distinguish real vs impersonated actions.
    cafe_id         UUID REFERENCES public.cafes(id),
    -- ↑ NULLable: super-admin maintenance writes may have no cafe context.
    --   Trigger-driven audit rows always have it (= NEW.cafe_id of the audited row).
    action          TEXT NOT NULL,
    entity          TEXT NOT NULL,
    entity_id       UUID NOT NULL,
    diff            JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity  ON public.audit_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor   ON public.audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON public.audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_cafe        ON public.audit_log(cafe_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGERS
-- ─────────────────────────────────────────────────────────────────────────────

-- Generic updated_at touch.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS cafes_updated_at ON public.cafes;
CREATE TRIGGER cafes_updated_at
    BEFORE UPDATE ON public.cafes
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS leave_requests_updated_at ON public.leave_requests;
CREATE TRIGGER leave_requests_updated_at
    BEFORE UPDATE ON public.leave_requests
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS timesheets_updated_at ON public.timesheets;
CREATE TRIGGER timesheets_updated_at
    BEFORE UPDATE ON public.timesheets
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Reads the actor from a session GUC set by the app layer (`SET LOCAL app.actor_id = '<uuid>'`).
-- Returns NULL if unset; audit triggers below treat NULL as "no actor" and skip the log row
-- rather than violating the NOT NULL constraint.
CREATE OR REPLACE FUNCTION public.current_actor_id()
RETURNS UUID AS $$
DECLARE
    v TEXT;
BEGIN
    v := current_setting('app.actor_id', TRUE);
    IF v IS NULL OR v = '' THEN
        RETURN NULL;
    END IF;
    RETURN v::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

-- current_cafe_id() — set by withTenantTx via SET LOCAL app.cafe_id.
-- Used by the Phase H tripwire triggers as a defense-in-depth check.
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

-- current_impersonator_id() — set by withTenantTx when the JWT carries an
-- impersonator_id claim (super admin acting "as" another user).
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

DROP TRIGGER IF EXISTS audit_timesheet_change ON public.timesheets;
CREATE TRIGGER audit_timesheet_change
    AFTER UPDATE ON public.timesheets
    FOR EACH ROW EXECUTE FUNCTION public.log_timesheet_change();

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

DROP TRIGGER IF EXISTS audit_leave_change ON public.leave_requests;
CREATE TRIGGER audit_leave_change
    AFTER UPDATE ON public.leave_requests
    FOR EACH ROW EXECUTE FUNCTION public.log_leave_change();
