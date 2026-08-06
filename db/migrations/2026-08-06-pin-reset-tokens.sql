-- Secure self-service PIN recovery through a user's already-linked private
-- Telegram chat. Codes are HMACed in the app, expire quickly, are single-use,
-- and are rate/attempt limited.

BEGIN;

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

COMMIT;
