-- @migration 407_purchase_variance_decisions.sql
-- @domain purchasing
-- @purpose Decision distincte et immuable du détenteur du grant supplier_payment
--            pour dépasser, dans une devise, le total vendeur réellement justifié.
-- @added-header 2026-11-12
CREATE TABLE IF NOT EXISTS public.purchase_variance_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  approved_total numeric(18,4) NOT NULL CHECK (approved_total > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 5),
  proof_ref text NOT NULL CHECK (length(btrim(proof_ref)) > 0),
  decided_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(purchase_order_id, currency)
);
CREATE OR REPLACE FUNCTION public.purchase_variance_decisions_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'purchase_variance_decision_immutable' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS trg_purchase_variance_decisions_immutable ON public.purchase_variance_decisions;
CREATE TRIGGER trg_purchase_variance_decisions_immutable
  BEFORE UPDATE OR DELETE ON public.purchase_variance_decisions
  FOR EACH ROW EXECUTE FUNCTION public.purchase_variance_decisions_immutable();
