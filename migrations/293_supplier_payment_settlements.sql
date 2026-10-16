-- @migration 293_supplier_payment_settlements.sql
-- @domain    purchasing / economic-engine
-- @purpose   Faits append-only de règlement fournisseur en KMF réellement débités (coût d'achat réel).
--
-- Un supplier_execution_payment dit « combien en devise fournisseur » ; il ne dit jamais
-- combien de KMF ont réellement été débités ni à quel taux. Cette table porte ce fait,
-- saisi par un admin avec preuve, par opération (paiements partiels multi-taux acceptés) :
--   payment       KMF débités pour un règlement (hors frais) ; fees_kmf = frais bancaires/conversion de l'opération
--   goods_refund  remboursement de marchandises : seul à réduire le coût d'achat
--   fee_refund    remboursement de frais : réduit le coût `payment`, jamais l'achat
--   other_refund  journalisé sans effet sur l'achat ni sur les frais
-- Le signe est porté par kind (montants toujours > 0). Le taux effectif n'est jamais stocké :
-- il se calcule (Σ KMF / Σ devise). Aucun taux de référence n'est utilisé.
-- Append-only : correction = nouvelle ligne de compensation (un refund typé), pas de kind
-- 'correction' (il rouvrirait un signe libre et contournerait les plafonds de remboursement).
--
-- Additive, aucun backfill, aucun débit, aucune écriture dans les allocations de coût.
-- Rollback : DROP TABLE public.supplier_payment_settlements; DROP FUNCTION
-- public.supplier_payment_settlements_immutable(); (aucune autre table n'en dépend).

DO $pre$
BEGIN
  IF to_regclass('public.supplier_execution_payments') IS NULL THEN
    RAISE EXCEPTION '293 precondition: migration 280 requise (supplier_execution_payments)';
  END IF;
  IF to_regclass('public.supplier_payment_settlements') IS NOT NULL THEN
    RAISE EXCEPTION '293 precondition: supplier_payment_settlements déjà présente (état inattendu)';
  END IF;
END
$pre$;

CREATE TABLE public.supplier_payment_settlements (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_execution_payment_id uuid NOT NULL
    REFERENCES public.supplier_execution_payments(id) ON DELETE RESTRICT,
  kind             text NOT NULL,
  amount_currency  numeric(18,4) NOT NULL,
  currency         text NOT NULL,
  amount_kmf       numeric(14,2) NOT NULL,
  fees_kmf         numeric(14,2) NOT NULL DEFAULT 0,
  proof_ref        text NOT NULL,
  idempotency_key  text NOT NULL,
  notes            text NULL,
  recorded_by      uuid NULL,
  recorded_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_sps_kind CHECK (kind IN ('payment','goods_refund','fee_refund','other_refund')),
  CONSTRAINT chk_sps_amount_currency CHECK (amount_currency > 0),
  CONSTRAINT chk_sps_currency CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT chk_sps_amount_kmf CHECK (amount_kmf > 0),
  CONSTRAINT chk_sps_fees CHECK (fees_kmf >= 0),
  CONSTRAINT chk_sps_fees_only_on_payment CHECK (kind = 'payment' OR fees_kmf = 0),
  CONSTRAINT chk_sps_proof CHECK (btrim(proof_ref) <> ''),
  CONSTRAINT chk_sps_idem CHECK (btrim(idempotency_key) <> ''),
  CONSTRAINT uq_sps_payment_idempotency UNIQUE (supplier_execution_payment_id, idempotency_key)
);

CREATE INDEX idx_sps_payment ON public.supplier_payment_settlements(supplier_execution_payment_id);

CREATE OR REPLACE FUNCTION public.supplier_payment_settlements_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'supplier_payment_settlements est append-only (% interdit) : corriger par une ligne de compensation', TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER trg_sps_immutable
  BEFORE UPDATE OR DELETE ON public.supplier_payment_settlements
  FOR EACH ROW EXECUTE FUNCTION public.supplier_payment_settlements_immutable();

CREATE TRIGGER trg_sps_no_truncate
  BEFORE TRUNCATE ON public.supplier_payment_settlements
  FOR EACH STATEMENT EXECUTE FUNCTION public.supplier_payment_settlements_immutable();

COMMENT ON TABLE public.supplier_payment_settlements IS
  'Règlements fournisseur réellement débités en KMF (append-only) : payment / goods_refund / fee_refund / other_refund ; taux effectif calculé, jamais stocké.';
