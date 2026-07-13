-- Phase 2 (blocker 5): replace phone-only Telegram linking with authenticated,
-- single-use, short-lived link codes.
--
-- Before: sending "/link +65..." to the bot bound that chat to whoever owned the
-- phone number — so knowing someone's number was enough to steal their notifications.
-- After: a signed-in user mints a one-time code in-app and sends "/link CODE" from
-- a PRIVATE chat. This table holds those codes.
--
-- Additive + idempotent.
-- Apply:  psql "$POSTGRES_URL_NON_POOLING" -f db/migrations/2026-07-13-telegram-link-codes.sql

BEGIN;

CREATE TABLE IF NOT EXISTS public.telegram_link_codes (
    code       TEXT PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_user ON public.telegram_link_codes(user_id);

COMMIT;
