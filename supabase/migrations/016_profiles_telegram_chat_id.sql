-- Migration: bind Telegram chat IDs to profiles for outbound DM notifications.
-- Idempotent: safe to re-run.
--
-- App DB is Neon — auth & access control live in the Next.js layer
-- (src/lib/auth.ts + middleware). The supabase/migrations/ folder is kept
-- only as a historical naming convention.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
