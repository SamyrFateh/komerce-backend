-- @migration 281_supplier_payment_proofs.sql
-- @domain    purchasing
-- @purpose   Conserver les preuves monétaires provider liées à un paiement fournisseur canonique.
--
-- Aucun payload brut provider n'est stocké. Seulement les faits utiles à
-- l'audit/replay et à la promotion de real_debit_verified.

CREATE TABLE IF NOT EXISTS public.supplier_execution_payment_proofs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_payment_id   uuid NOT NULL
    REFERENCES public.supplier_execution_payments(id) ON DELETE RESTRICT,
  provider              text NOT NULL,
  proof_source          text NOT NULL,
  proof_ref             text NOT NULL,
  provider_order_id     text NULL,
  payment_ref           text NULL,
  observed_amount       numeric(18,4) NOT NULL,
  currency              text NOT NULL,
  debit_confirmed       boolean NOT NULL DEFAULT false,
  sandbox               boolean NOT NULL DEFAULT false,
  simulated             boolean NOT NULL DEFAULT false,
  occurred_at           timestamptz NULL,
  provider_facts        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_supplier_payment_proofs_provider
    CHECK (btrim(provider) <> ''),
  CONSTRAINT chk_supplier_payment_proofs_source
    CHECK (btrim(proof_source) <> ''),
  CONSTRAINT chk_supplier_payment_proofs_ref
    CHECK (btrim(proof_ref) <> ''),
  CONSTRAINT chk_supplier_payment_proofs_amount
    CHECK (observed_amount > 0),
  CONSTRAINT chk_supplier_payment_proofs_currency
    CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT chk_supplier_payment_proofs_facts_object
    CHECK (jsonb_typeof(provider_facts) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_payment_proofs_native_ref
  ON public.supplier_execution_payment_proofs(provider, proof_source, proof_ref);

CREATE INDEX IF NOT EXISTS idx_supplier_payment_proofs_payment
  ON public.supplier_execution_payment_proofs(supplier_payment_id);

COMMENT ON TABLE public.supplier_execution_payment_proofs IS
  'Preuves monétaires provider liées à supplier_execution_payments. Faits bornés uniquement; aucun payload brut ni secret.';
