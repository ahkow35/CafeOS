-- The leave audit trigger (log_leave_change) only fired AFTER UPDATE, so two
-- balance-affecting paths left no audit_log row at all:
--   1. An owner's own leave request is INSERTed already 'approved' (self-approval —
--      see POST /api/leave-requests) with the balance deducted in the same tx.
--   2. An owner purging a decided (approved/rejected) request DELETEs the row and,
--      for an approved one, refunds the balance (see DELETE /api/leave-requests/[id]).
-- Neither operation is an UPDATE, so both were invisible to the audit trail.
--
-- This redefines log_leave_change() to also handle INSERT (log only when the row
-- lands already 'approved' — i.e. self-approval) and DELETE (always log; record
-- whether the delete triggered a balance refund, mirroring the route's refund
-- rule: status IN ('pending_manager','pending_owner','approved')). The existing
-- UPDATE branch is unchanged.
--
-- Caveat: leave_requests.user_id is ON DELETE CASCADE from profiles. If a profile
-- is ever hard-deleted while app.actor_id is set, the DELETE branch above fires
-- once per cascaded leave_requests row, and its 'refunded' flag reflects that
-- row's last status even though a cascade never actually refunds a balance. No
-- code path hard-deletes profiles today — DELETE /api/admin/users/[id] soft-
-- suspends the cafe_memberships row, it does not touch profiles. A future
-- maintenance script that does hard-delete profiles should clear app.actor_id
-- first, or expect these rows in the audit trail.
--
-- Safe to apply twice — CREATE OR REPLACE FUNCTION and DROP TRIGGER IF EXISTS /
-- CREATE TRIGGER are both idempotent.
--
-- ROLLBACK (paste without the leading "-- "):
-- CREATE OR REPLACE FUNCTION public.log_leave_change()
-- RETURNS TRIGGER AS $$
-- DECLARE
--     actor UUID := public.current_actor_id();
-- BEGIN
--     IF actor IS NULL THEN
--         RETURN NEW;
--     END IF;
--     IF OLD.status IS DISTINCT FROM NEW.status THEN
--         INSERT INTO public.audit_log (actor_id, impersonator_id, cafe_id, action, entity, entity_id, diff)
--         VALUES (
--             actor,
--             public.current_impersonator_id(),
--             NEW.cafe_id,
--             CASE NEW.status
--                 WHEN 'approved' THEN 'approve'
--                 WHEN 'rejected' THEN 'reject'
--                 ELSE 'update'
--             END,
--             'leave_request',
--             NEW.id,
--             jsonb_build_object('status', jsonb_build_array(OLD.status, NEW.status))
--         );
--     END IF;
--     RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;
--
-- DROP TRIGGER IF EXISTS audit_leave_change ON public.leave_requests;
-- CREATE TRIGGER audit_leave_change AFTER UPDATE ON public.leave_requests FOR EACH ROW EXECUTE FUNCTION public.log_leave_change();

BEGIN;

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

COMMIT;
