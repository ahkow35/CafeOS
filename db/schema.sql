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
    -- ↓ DEPRECATED: café-scoped employment data moved to cafe_memberships
    --   (Option A). Kept until a later phase drops them after prod soak.
    annual_leave_balance  INTEGER NOT NULL DEFAULT 14,
    medical_leave_balance INTEGER NOT NULL DEFAULT 14,
    hourly_rate           NUMERIC(10,2),
    -- is_active remains the GLOBAL account flag (not deprecated).
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    -- Bumped on PIN reset / global disable to invalidate older JWTs immediately.
    token_version         INTEGER NOT NULL DEFAULT 0,
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
    -- Stripe billing (SGD 49/mo per cafe, 14-day trial). See 2026-05-09-billing.sql.
    stripe_customer_id     TEXT UNIQUE,
    stripe_subscription_id TEXT UNIQUE,
    trial_ends_at          TIMESTAMPTZ,
    subscription_status    TEXT,
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
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cafe_id               UUID NOT NULL REFERENCES public.cafes(id) ON DELETE CASCADE,
    user_id               UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role                  TEXT NOT NULL CHECK (role IN ('staff', 'manager', 'owner', 'part_timer')),
    status                TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('pending', 'active', 'suspended')),
    -- Café-scoped employment data (Option A). Lives here, not on profiles, so a
    -- café owner can only edit a person's employment terms in THEIR café.
    job_title             TEXT,
    annual_leave_balance  INTEGER NOT NULL DEFAULT 14,
    medical_leave_balance INTEGER NOT NULL DEFAULT 14,
    hourly_rate           NUMERIC(10,2),
    -- Per-café employment switch (distinct from `status` and profiles.is_active).
    employment_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (cafe_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON public.cafe_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_cafe ON public.cafe_memberships(cafe_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- TELEGRAM LINK CODES (authenticated, single-use, short-lived)
-- Replaces phone-based linking: a signed-in user mints a code, then sends
-- "/link CODE" from a private Telegram chat to bind their notifications.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.telegram_link_codes (
    code       TEXT PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_user ON public.telegram_link_codes(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- PIN RESET TOKENS (self-service recovery via linked private Telegram)
-- Codes are HMACed by the app, short-lived, single-use, and attempt-limited.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pin_reset_tokens (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id            UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    code_hash          TEXT NOT NULL,
    request_ip_hash    TEXT NOT NULL,
    attempts_remaining SMALLINT NOT NULL DEFAULT 5
                           CHECK (attempts_remaining BETWEEN 0 AND 5),
    expires_at         TIMESTAMPTZ NOT NULL,
    used_at            TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pin_reset_tokens_user_created
    ON public.pin_reset_tokens(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pin_reset_tokens_ip_created
    ON public.pin_reset_tokens(request_ip_hash, created_at DESC);

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

-- Per-user completion for 'all' (everyone) tasks. Individual tasks use tasks.status.
CREATE TABLE IF NOT EXISTS public.task_completions (
    task_id      UUID NOT NULL REFERENCES public.tasks(id)    ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (task_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_task_completions_user ON public.task_completions(user_id);
CREATE INDEX IF NOT EXISTS idx_task_completions_task ON public.task_completions(task_id);

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
    -- Per-cafe uniqueness: a multi-cafe user may hold one timesheet per month
    -- in each cafe. (Was UNIQUE(user_id, month_year) — global per user.)
    CONSTRAINT timesheets_cafe_user_month_key UNIQUE (cafe_id, user_id, month_year)
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

-- Handles UPDATE (status transitions), INSERT (owner self-approval — a leave
-- request an owner submits lands already 'approved' with the balance deducted
-- in the same tx, so it needs its own audit row), and DELETE (owner purging a
-- decided record, or cancelling a pending one — 'refunded' mirrors the DELETE
-- route's refund rule: pending_manager/pending_owner/approved get refunded).
CREATE OR REPLACE FUNCTION public.log_leave_change()
RETURNS TRIGGER AS $$
DECLARE
    actor UUID := public.current_actor_id();
BEGIN
    IF actor IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    IF TG_OP = 'INSERT' THEN
        -- Only owners can insert an already-approved row (self-approval); anything
        -- else starts pending and gets its first audit row from the UPDATE branch.
        IF NEW.status = 'approved' THEN
            INSERT INTO public.audit_log (actor_id, impersonator_id, cafe_id, action, entity, entity_id, diff)
            VALUES (
                actor,
                public.current_impersonator_id(),
                NEW.cafe_id,
                'approve',
                'leave_request',
                NEW.id,
                jsonb_build_object(
                    'status', jsonb_build_array(NULL, 'approved'),
                    'days_requested', NEW.days_requested,
                    'leave_type', NEW.leave_type,
                    'self_approved', true
                )
            );
        END IF;
        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO public.audit_log (actor_id, impersonator_id, cafe_id, action, entity, entity_id, diff)
        VALUES (
            actor,
            public.current_impersonator_id(),
            OLD.cafe_id,
            'delete',
            'leave_request',
            OLD.id,
            jsonb_build_object(
                'status', jsonb_build_array(OLD.status, NULL),
                'days_requested', OLD.days_requested,
                'leave_type', OLD.leave_type,
                'refunded', (OLD.status IN ('pending_manager', 'pending_owner', 'approved'))
            )
        );
        RETURN OLD;

    ELSE -- TG_OP = 'UPDATE'
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
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_leave_change ON public.leave_requests;
CREATE TRIGGER audit_leave_change
    AFTER INSERT OR UPDATE OR DELETE ON public.leave_requests
    FOR EACH ROW EXECUTE FUNCTION public.log_leave_change();

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE H: TENANT TRIPWIRES — defence-in-depth cafe_id isolation
-- Raises a check_violation if a row's cafe_id doesn't match the app.cafe_id GUC
-- set by withTenantTx(). No-ops when app.cafe_id is unset (super-admin/maintenance
-- paths). Mirrors db/migrations/2026-05-04-tripwire-triggers.sql so a database
-- built from this file alone (not migrated forward) still has the guard.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assert_cafe_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  guc_cafe text := current_setting('app.cafe_id', true);
BEGIN
  -- GUC not set → super-admin or maintenance path; skip check.
  IF guc_cafe IS NULL OR guc_cafe = '' THEN
    RETURN NEW;
  END IF;

  -- audit_log rows stamped by the system may have NULL cafe_id (e.g. super-admin actions).
  IF NEW.cafe_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.cafe_id::text <> guc_cafe THEN
    RAISE EXCEPTION 'cafe_id mismatch: row cafe_id=% but app.cafe_id=%',
      NEW.cafe_id, guc_cafe
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assert_cafe_match ON public.leave_requests;
CREATE TRIGGER trg_assert_cafe_match
    BEFORE INSERT OR UPDATE ON public.leave_requests
    FOR EACH ROW EXECUTE FUNCTION public.assert_cafe_match();

DROP TRIGGER IF EXISTS trg_assert_cafe_match ON public.timesheets;
CREATE TRIGGER trg_assert_cafe_match
    BEFORE INSERT OR UPDATE ON public.timesheets
    FOR EACH ROW EXECUTE FUNCTION public.assert_cafe_match();

DROP TRIGGER IF EXISTS trg_assert_cafe_match ON public.timesheet_entries;
CREATE TRIGGER trg_assert_cafe_match
    BEFORE INSERT OR UPDATE ON public.timesheet_entries
    FOR EACH ROW EXECUTE FUNCTION public.assert_cafe_match();

DROP TRIGGER IF EXISTS trg_assert_cafe_match ON public.tasks;
CREATE TRIGGER trg_assert_cafe_match
    BEFORE INSERT OR UPDATE ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.assert_cafe_match();

DROP TRIGGER IF EXISTS trg_assert_cafe_match ON public.audit_log;
CREATE TRIGGER trg_assert_cafe_match
    BEFORE INSERT OR UPDATE ON public.audit_log
    FOR EACH ROW EXECUTE FUNCTION public.assert_cafe_match();

DROP TRIGGER IF EXISTS trg_assert_cafe_match ON public.cafe_memberships;
CREATE TRIGGER trg_assert_cafe_match
    BEFORE INSERT OR UPDATE ON public.cafe_memberships
    FOR EACH ROW EXECUTE FUNCTION public.assert_cafe_match();
