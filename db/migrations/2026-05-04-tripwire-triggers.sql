-- Phase H: Tripwire triggers — defence-in-depth tenant isolation.
-- Raises a check_violation if a row's cafe_id doesn't match the app.cafe_id GUC
-- set by withTenantTx(). No-ops when app.cafe_id is unset (super-admin/maintenance paths).
--
-- Install AFTER deploying the Phase H app build. Run on Neon via psql.

BEGIN;

CREATE OR REPLACE FUNCTION assert_cafe_match()
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

-- Install on all tenant-scoped tables.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'leave_requests',
    'timesheets',
    'timesheet_entries',
    'tasks',
    'audit_log',
    'cafe_memberships'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_assert_cafe_match ON %I;
       CREATE TRIGGER trg_assert_cafe_match
         BEFORE INSERT OR UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION assert_cafe_match();',
      tbl, tbl
    );
  END LOOP;
END;
$$;

COMMIT;
