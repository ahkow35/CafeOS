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
    pin_hash              TEXT NOT NULL,
    failed_attempts       INTEGER NOT NULL DEFAULT 0,
    locked_until          TIMESTAMPTZ,
    annual_leave_balance  INTEGER NOT NULL DEFAULT 14,
    medical_leave_balance INTEGER NOT NULL DEFAULT 14,
    hourly_rate           NUMERIC(10,2),
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    email                 TEXT, -- legacy display only; not used for auth
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_phone ON public.profiles(phone_e164);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role) WHERE is_active = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- LEAVE REQUESTS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leave_requests (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

CREATE INDEX IF NOT EXISTS idx_leave_requests_user ON public.leave_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON public.leave_requests(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- TASKS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tasks (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title         TEXT NOT NULL,
    description   TEXT,
    deadline      TIMESTAMPTZ NOT NULL,
    assigned_to   TEXT NOT NULL DEFAULT 'all', -- 'all' or profile UUID as text
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
    created_by    UUID NOT NULL REFERENCES public.profiles(id),
    completed_by  UUID REFERENCES public.profiles(id),
    completed_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON public.tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- TIMESHEETS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.timesheets (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    month_year          TEXT NOT NULL, -- 'YYYY-MM'
    status              TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
    comments            TEXT,
    rejection_reason    TEXT,
    employee_signature  TEXT,
    manager_signature   TEXT,
    approved_by         UUID REFERENCES public.profiles(id),
    approved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, month_year)
);

CREATE INDEX IF NOT EXISTS idx_timesheets_user ON public.timesheets(user_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_status ON public.timesheets(status);

CREATE TABLE IF NOT EXISTS public.timesheet_entries (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

-- ─────────────────────────────────────────────────────────────────────────────
-- AUDIT LOG
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id    UUID NOT NULL REFERENCES public.profiles(id),
    action      TEXT NOT NULL,
    entity      TEXT NOT NULL,
    entity_id   UUID NOT NULL,
    diff        JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON public.audit_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON public.audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON public.audit_log(created_at DESC);

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

CREATE OR REPLACE FUNCTION public.log_timesheet_change()
RETURNS TRIGGER AS $$
DECLARE
    actor UUID := public.current_actor_id();
BEGIN
    IF actor IS NULL THEN
        RETURN NEW;
    END IF;
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO public.audit_log (actor_id, action, entity, entity_id, diff)
        VALUES (
            actor,
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
        INSERT INTO public.audit_log (actor_id, action, entity, entity_id, diff)
        VALUES (
            actor,
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
