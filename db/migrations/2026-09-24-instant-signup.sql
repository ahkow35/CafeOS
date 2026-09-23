-- db/migrations/2026-09-24-instant-signup.sql
--
-- Adds the instant café signup flow (form -> Telegram verification -> Stripe
-- trial -> PIN set), fully additive. Apply to production BEFORE merging the
-- build/instant-cafe-signup-telegram PR — the new routes read/write these
-- tables from the moment the deploy goes live.
--
-- cafe_signups: one row per /start submission on the instant path. cafe_id is
-- generated up front (before Stripe/DB provisioning) so a retry after a
-- partial failure reuses the same café id and the same Stripe idempotency key.
BEGIN;

CREATE TABLE IF NOT EXISTS public.cafe_signups (
    id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cafe_id                UUID NOT NULL,
    cafe_name              TEXT NOT NULL,
    owner_name             TEXT NOT NULL,
    phone_e164             TEXT NOT NULL,
    email                  TEXT,
    token_hash             TEXT NOT NULL,
    telegram_user_id       BIGINT,
    status                 TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'verified', 'provisioned', 'completed', 'expired')),
    stripe_customer_id     TEXT,
    stripe_subscription_id TEXT,
    trial_ends_at          TIMESTAMPTZ,
    request_ip_hash        TEXT NOT NULL,
    expires_at             TIMESTAMPTZ NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Token is a 32-byte random value — a plain unique index (not partial) is
-- fine and gives O(1) lookup for the webhook's /start <token> handler.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cafe_signups_token_hash
    ON public.cafe_signups(token_hash);

-- DB-enforced "at most one OPEN signup per phone". 'provisioned' counts as
-- open (Stripe succeeded but the profile/cafe row hasn't landed yet) so a
-- second form submission can't race a retry-in-progress.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cafe_signups_open_phone
    ON public.cafe_signups(phone_e164)
    WHERE status IN ('pending', 'verified', 'provisioned');

CREATE INDEX IF NOT EXISTS idx_cafe_signups_phone_created
    ON public.cafe_signups(phone_e164, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cafe_signups_ip_created
    ON public.cafe_signups(request_ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cafe_signups_telegram_user
    ON public.cafe_signups(telegram_user_id);

-- Per-Telegram-user rate limit on the bot steps (/start <token>, sharing a
-- contact). Rows are cheap and short-lived; nothing ever reads them except
-- the atomic count-and-insert in the webhook handler.
CREATE TABLE IF NOT EXISTS public.signup_bot_attempts (
    telegram_user_id BIGINT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_signup_bot_attempts_user_created
    ON public.signup_bot_attempts(telegram_user_id, created_at DESC);

-- One-time "set your PIN" link sent after provisioning. Separate from
-- pin_reset_tokens: this issues the FIRST real PIN for a brand-new instant
-- signup (no existing PIN to compare against, no attempt-limited guessable
-- code — it's a possession-based link, not a typed-in code).
CREATE TABLE IF NOT EXISTS public.pin_set_tokens (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pin_set_tokens_token_hash
    ON public.pin_set_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_pin_set_tokens_user
    ON public.pin_set_tokens(user_id);

COMMIT;
