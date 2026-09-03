-- Medical claims: per-employee yearly cap on cafe_memberships, one row per
-- receipt in medical_claims. Balance is deducted ON APPROVAL only.
-- audit_claim_change fires on INSERT/UPDATE/DELETE so an owner's self-approved
-- insert and an approved-claim purge (DELETE) both leave an audit_log row, not
-- just status-changing UPDATEs.
-- Additive. Rollback: DROP TABLE medical_claims; ALTER TABLE cafe_memberships DROP COLUMN medical_claim_balance; DROP FUNCTION public.log_claim_change();

BEGIN;

ALTER TABLE public.cafe_memberships
  ADD COLUMN IF NOT EXISTS medical_claim_balance NUMERIC(10,2) NOT NULL DEFAULT 0
    CHECK (medical_claim_balance >= 0 AND medical_claim_balance <= 99999.99);

CREATE TABLE IF NOT EXISTS public.medical_claims (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cafe_id         UUID NOT NULL REFERENCES public.cafes(id),
    user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    receipt_date    DATE NOT NULL,
    amount_claimed  NUMERIC(10,2) NOT NULL CHECK (amount_claimed > 0 AND amount_claimed <= 9999.99),
    amount_approved NUMERIC(10,2),
    description     TEXT,
    receipt_url     TEXT NOT NULL,            -- Vercel Blob URL; never sent raw to clients
    status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected')),
    decided_by      UUID REFERENCES public.profiles(id),
    decided_at      TIMESTAMPTZ,
    decision_note   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT medical_claims_amount_approved_within_claimed CHECK (
      amount_approved IS NULL OR (amount_approved > 0 AND amount_approved <= amount_claimed)
    ),
    CONSTRAINT medical_claims_decided_consistent CHECK (
      (status = 'pending'  AND amount_approved IS NULL     AND decided_by IS NULL     AND decided_at IS NULL) OR
      (status = 'approved' AND amount_approved IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL) OR
      (status = 'rejected' AND amount_approved IS NULL     AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_claims_cafe_user   ON public.medical_claims(cafe_id, user_id);
CREATE INDEX IF NOT EXISTS idx_claims_cafe_status ON public.medical_claims(cafe_id, status);

DROP TRIGGER IF EXISTS medical_claims_updated_at ON public.medical_claims;
CREATE TRIGGER medical_claims_updated_at
    BEFORE UPDATE ON public.medical_claims
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.log_claim_change()
RETURNS TRIGGER AS $$
DECLARE
    actor UUID := public.current_actor_id();
BEGIN
    IF actor IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    IF TG_OP = 'INSERT' THEN
        -- Only an owner's self-submitted claim arrives already decided; a pending
        -- insert moves no money and is not audited.
        IF NEW.status = 'approved' THEN
            INSERT INTO public.audit_log (actor_id, impersonator_id, cafe_id, action, entity, entity_id, diff)
            VALUES (actor, public.current_impersonator_id(), NEW.cafe_id, 'approve', 'medical_claim', NEW.id,
                    jsonb_build_object('status', jsonb_build_array(NULL, NEW.status),
                                       'amount_approved', NEW.amount_approved,
                                       'self_approved', TRUE));
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        INSERT INTO public.audit_log (actor_id, impersonator_id, cafe_id, action, entity, entity_id, diff)
        VALUES (actor, public.current_impersonator_id(), OLD.cafe_id, 'delete', 'medical_claim', OLD.id,
                jsonb_build_object('status', jsonb_build_array(OLD.status, NULL),
                                   'amount_claimed', OLD.amount_claimed,
                                   'amount_approved', OLD.amount_approved,
                                   'refunded', (OLD.status = 'approved')));
        RETURN OLD;
    END IF;

    -- UPDATE
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
            'medical_claim',
            NEW.id,
            jsonb_build_object(
              'status', jsonb_build_array(OLD.status, NEW.status),
              'amount_approved', NEW.amount_approved
            )
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_claim_change ON public.medical_claims;
CREATE TRIGGER audit_claim_change
    AFTER INSERT OR UPDATE OR DELETE ON public.medical_claims
    FOR EACH ROW EXECUTE FUNCTION public.log_claim_change();

-- Phase H tenant tripwire (see 2026-05-04-tripwire-triggers.sql). Guarded because
-- db/schema.sql alone does not define assert_cafe_match(); production does.
DO $$
BEGIN
  IF to_regproc('public.assert_cafe_match') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_assert_cafe_match ON public.medical_claims';
    EXECUTE 'CREATE TRIGGER trg_assert_cafe_match
               BEFORE INSERT OR UPDATE ON public.medical_claims
               FOR EACH ROW EXECUTE FUNCTION public.assert_cafe_match()';
  ELSE
    RAISE NOTICE 'assert_cafe_match() absent - tripwire NOT installed on medical_claims';
  END IF;
END $$;

COMMIT;
