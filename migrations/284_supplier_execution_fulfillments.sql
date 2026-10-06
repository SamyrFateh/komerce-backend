-- @migration 284_supplier_execution_fulfillments.sql
-- @domain    purchasing
-- @purpose   Fait canonique de fulfillment fournisseur, distinct de ORDER, PAYMENT et de la logistique physique Komerce.
--
-- Cette table ne déclenche aucune expédition et ne remplace ni parcels ni shipments.
-- Elle conserve uniquement les faits provider bornés nécessaires à la réconciliation FULFILLMENT.

CREATE TABLE IF NOT EXISTS public.supplier_execution_fulfillments (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_execution_order_id  uuid NOT NULL
    REFERENCES public.supplier_execution_orders(id) ON DELETE RESTRICT,
  provider                     text NOT NULL,
  fulfillment_execution_key    text NOT NULL,
  expected_quantity            integer NOT NULL,
  observed_quantity            integer NULL,
  provider_status              text NULL,
  carrier                      text NULL,
  tracking_number              text NULL,
  tracking_url                 text NULL,
  shipped_at                   timestamptz NULL,
  delivered_at                 timestamptz NULL,
  reconciliation_status        text NOT NULL DEFAULT 'pending',
  evidence_source              text NULL,
  evidence_ref                 text NULL,
  facts                        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_supplier_execution_fulfillments_provider
    CHECK (btrim(provider) <> ''),
  CONSTRAINT chk_supplier_execution_fulfillments_key
    CHECK (btrim(fulfillment_execution_key) <> ''),
  CONSTRAINT chk_supplier_execution_fulfillments_expected_qty
    CHECK (expected_quantity > 0),
  CONSTRAINT chk_supplier_execution_fulfillments_observed_qty
    CHECK (observed_quantity IS NULL OR observed_quantity >= 0),
  CONSTRAINT chk_supplier_execution_fulfillments_status
    CHECK (reconciliation_status IN ('matched','not_found','mismatch','ambiguous','pending')),
  CONSTRAINT chk_supplier_execution_fulfillments_tracking
    CHECK (tracking_number IS NULL OR btrim(tracking_number) <> ''),
  CONSTRAINT chk_supplier_execution_fulfillments_facts_object
    CHECK (jsonb_typeof(facts) = 'object'),
  CONSTRAINT chk_supplier_execution_fulfillments_delivered_after_shipped
    CHECK (delivered_at IS NULL OR shipped_at IS NULL OR delivered_at >= shipped_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_execution_fulfillments_execution_key
  ON public.supplier_execution_fulfillments(provider, fulfillment_execution_key);

CREATE INDEX IF NOT EXISTS idx_supplier_execution_fulfillments_order
  ON public.supplier_execution_fulfillments(supplier_execution_order_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_execution_fulfillments_evidence
  ON public.supplier_execution_fulfillments(provider, evidence_source, evidence_ref)
  WHERE evidence_source IS NOT NULL AND evidence_ref IS NOT NULL;

COMMENT ON TABLE public.supplier_execution_fulfillments IS
  'Fait canonique provider-side de fulfillment. Ne prouve pas la réception Hub ni la remise client; celles-ci restent propriétaires de Logistics.';
