-- @migration 280_supplier_execution_payments.sql
-- @domain    purchasing
-- @purpose   Persistance canonique des faits de paiement fournisseur avant tout debit production.
--
-- Cette table ne déclenche aucun paiement. Elle fournit l'identité locale stable,
-- le montant attendu, le montant observé et le verdict de rapprochement nécessaires
-- pour rendre un futur paiement provider reprenable et anti-double-debit.
--
-- Une tentative cible exactement un sous-ordre OU un parent provider.

CREATE TABLE IF NOT EXISTS public.supplier_execution_payments (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id            uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
  provider                     text NOT NULL,
  payment_execution_key        text NOT NULL,
  supplier_execution_order_id  uuid NULL REFERENCES public.supplier_execution_orders(id) ON DELETE RESTRICT,
  supplier_execution_group_id  uuid NULL REFERENCES public.supplier_execution_groups(id) ON DELETE RESTRICT,
  payment_ref                  text NULL,
  expected_amount              numeric(18,4) NOT NULL,
  observed_amount              numeric(18,4) NULL,
  currency                     text NOT NULL,
  status                       text NOT NULL DEFAULT 'prepared',
  reconciliation_status        text NOT NULL DEFAULT 'pending',
  real_debit_verified          boolean NOT NULL DEFAULT false,
  provider_facts               jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_supplier_execution_payments_provider
    CHECK (btrim(provider) <> ''),
  CONSTRAINT chk_supplier_execution_payments_key
    CHECK (btrim(payment_execution_key) <> ''),
  CONSTRAINT chk_supplier_execution_payments_target_xor
    CHECK (
      (supplier_execution_order_id IS NOT NULL AND supplier_execution_group_id IS NULL)
      OR
      (supplier_execution_order_id IS NULL AND supplier_execution_group_id IS NOT NULL)
    ),
  CONSTRAINT chk_supplier_execution_payments_expected_amount
    CHECK (expected_amount > 0),
  CONSTRAINT chk_supplier_execution_payments_observed_amount
    CHECK (observed_amount IS NULL OR observed_amount > 0),
  CONSTRAINT chk_supplier_execution_payments_currency
    CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT chk_supplier_execution_payments_status
    CHECK (status IN ('prepared','requested','succeeded','ambiguous','rejected')),
  CONSTRAINT chk_supplier_execution_payments_reconciliation_status
    CHECK (reconciliation_status IN ('pending','matched','mismatched','unverified')),
  CONSTRAINT chk_supplier_execution_payments_ref
    CHECK (payment_ref IS NULL OR btrim(payment_ref) <> ''),
  CONSTRAINT chk_supplier_execution_payments_facts_object
    CHECK (jsonb_typeof(provider_facts) = 'object'),
  CONSTRAINT chk_supplier_execution_payments_real_debit
    CHECK (real_debit_verified = false OR status = 'succeeded')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_execution_payments_provider_key
  ON public.supplier_execution_payments(provider, payment_execution_key);

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_execution_payments_provider_ref
  ON public.supplier_execution_payments(provider, payment_ref)
  WHERE payment_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_execution_payments_purchase_order
  ON public.supplier_execution_payments(purchase_order_id);

CREATE INDEX IF NOT EXISTS idx_supplier_execution_payments_group
  ON public.supplier_execution_payments(supplier_execution_group_id)
  WHERE supplier_execution_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_execution_payments_order
  ON public.supplier_execution_payments(supplier_execution_order_id)
  WHERE supplier_execution_order_id IS NOT NULL;


-- La cible et la PO/provider du paiement doivent raconter la même conversation.
CREATE OR REPLACE FUNCTION public.supplier_execution_payments_guard()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_po uuid;
  v_provider text;
BEGIN
  IF NEW.supplier_execution_group_id IS NOT NULL THEN
    SELECT purchase_order_id, provider
      INTO v_po, v_provider
      FROM public.supplier_execution_groups
     WHERE id = NEW.supplier_execution_group_id
     FOR SHARE;
  ELSE
    SELECT purchase_order_id, provider
      INTO v_po, v_provider
      FROM public.supplier_execution_orders
     WHERE id = NEW.supplier_execution_order_id
     FOR SHARE;
  END IF;

  IF v_po IS NULL THEN
    RAISE EXCEPTION 'supplier_execution_payment_target_missing'
      USING ERRCODE = '23503';
  END IF;

  IF v_po IS DISTINCT FROM NEW.purchase_order_id
     OR v_provider IS DISTINCT FROM NEW.provider THEN
    RAISE EXCEPTION
      'supplier_execution_payment_target_mismatch: payment, target, purchase_order_id et provider doivent etre coherents'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_supplier_execution_payments_guard
  ON public.supplier_execution_payments;

CREATE TRIGGER trg_supplier_execution_payments_guard
  BEFORE INSERT OR UPDATE OF purchase_order_id, provider, supplier_execution_order_id, supplier_execution_group_id
  ON public.supplier_execution_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.supplier_execution_payments_guard();


COMMENT ON TABLE public.supplier_execution_payments IS
  'Fait canonique de paiement fournisseur: cible provider, cle idempotente locale, montant attendu/observe, devise et rapprochement. Ne declenche aucun debit a lui seul.';
COMMENT ON COLUMN public.supplier_execution_payments.payment_execution_key IS
  'Cle idempotente locale stable reutilisee lors des retries; unique dans le namespace du provider.';
COMMENT ON COLUMN public.supplier_execution_payments.real_debit_verified IS
  'True uniquement lorsqu un debit monetaire reel a ete prouve; sandbox/simulatePay doit rester false.';
