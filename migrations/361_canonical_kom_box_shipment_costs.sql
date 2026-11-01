-- 361 — Staging build : dossier KOM-BOX canonique, coûts financiers par expédition.
-- Never turn unknown invoice amounts into zeros, never allocate shipment invoices to items.
ALTER TABLE public.international_n1_reconciliations
  ADD COLUMN IF NOT EXISTS total_customs_kmf numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_customs_fees_kmf numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS documented_total_kmf numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS financial_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS financial_closed_by text,
  ADD COLUMN IF NOT EXISTS financial_close_proof_ref text;

ALTER TABLE public.international_n1_reconciliations
  DROP CONSTRAINT IF EXISTS chk_shipment_financial_close_proof;
ALTER TABLE public.international_n1_reconciliations
  ADD CONSTRAINT chk_shipment_financial_close_proof CHECK (
    (financial_closed_at IS NULL AND financial_closed_by IS NULL AND financial_close_proof_ref IS NULL)
    OR (financial_closed_at IS NOT NULL AND financial_closed_by IS NOT NULL
      AND financial_close_proof_ref IS NOT NULL AND length(btrim(financial_close_proof_ref))>0)
  );
COMMENT ON TABLE public.international_n1_reconciliations IS
  'Snapshot documented real costs BY SHIPMENT, for posterior calibration; zero article allocations. Financial closure distinct from physical relay receipt.';

-- Opening and declaring customs is evidenced separately from customs-service article allocation.
ALTER TABLE public.international_shipment_events
  DROP CONSTRAINT IF EXISTS international_shipment_events_event_type_check;
ALTER TABLE public.international_shipment_events
  ADD CONSTRAINT international_shipment_events_event_type_check CHECK
    (event_type IN ('created','opened','box_attached','box_detached','stage_changed',
      'tracking_updated','freight_recorded','customs_linked','customs_amount_confirmed'));
-- Guard left-overs from earlier test deployments, never silently erase real financial history.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.international_n1_allocation_links LIMIT 1) THEN
    RAISE EXCEPTION 'MIGRATION_361_REVIEW_ITEM_ALLOCATIONS: prior actual allocations must be reconciled before canonical clean';
  END IF;
  IF EXISTS (SELECT 1 FROM public.international_shipment_parcels LIMIT 1) THEN
    RAISE EXCEPTION 'MIGRATION_361_REVIEW_LEGACY_PARCELS: verify staging records before dropping old physical model';
  END IF;
END $$;
DROP TABLE public.international_n1_allocation_links;
DROP TABLE public.international_shipment_parcels;
COMMENT ON COLUMN public.international_n1_reconciliations.documented_total_kmf IS
  'Sum of documented sources at the shipment level. Financial completeness is never inferred from this total.';
