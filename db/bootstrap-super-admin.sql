-- Bootstrap the first super admin.
--
-- After at least one super admin exists, further super admins should be
-- granted via the /super/admins UI (POST /api/super/admins).
--
-- This script:
--   * Inserts or updates a profile with the given phone + name.
--   * Sets a fresh bcrypt PIN hash (via pgcrypto's $2a$ which bcryptjs accepts).
--   * Sets is_active = TRUE, is_super_admin = TRUE.
--   * Does NOT create any cafe membership — super admin is platform-scope.
--
-- Usage:
--     psql "$POSTGRES_URL" \
--       -v phone="'+6591234567'" \
--       -v name="'Platform Owner'" \
--       -v pin="'123456'" \
--       -f db/bootstrap-super-admin.sql
--
-- After running, log in at /login with the phone + PIN. The login flow will
-- detect 0 active memberships + is_super_admin = TRUE and route you to /super.
-- Change the PIN immediately from the profile screen.

\set ON_ERROR_STOP on

DO $$
DECLARE
    target_phone TEXT := :phone;
    target_name  TEXT := :name;
    target_pin   TEXT := :pin;
    pin_hash     TEXT;
BEGIN
    IF target_phone IS NULL OR target_phone = '' THEN
        RAISE EXCEPTION 'phone variable is required';
    END IF;
    IF target_name IS NULL OR target_name = '' THEN
        RAISE EXCEPTION 'name variable is required';
    END IF;
    IF target_pin !~ '^[0-9]{6}$' THEN
        RAISE EXCEPTION 'pin must be exactly 6 digits';
    END IF;

    pin_hash := crypt(target_pin, gen_salt('bf', 12));

    INSERT INTO public.profiles (phone_e164, full_name, role, pin_hash, is_active, is_super_admin)
    VALUES (target_phone, target_name, 'owner', pin_hash, TRUE, TRUE)
    ON CONFLICT (phone_e164) DO UPDATE
        SET full_name      = EXCLUDED.full_name,
            pin_hash       = EXCLUDED.pin_hash,
            is_active      = TRUE,
            is_super_admin = TRUE,
            failed_attempts = 0,
            locked_until   = NULL,
            updated_at     = NOW();

    RAISE NOTICE 'Super admin ready: % (PIN reset)', target_phone;
END $$;
