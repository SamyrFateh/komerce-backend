-- @migration 355_international_n1_reconciliation.sql
-- @domain economic-engine / logistics
-- Reconciliation is a projection of immutable international transport evidence.
-- No writes to customs_shipment_fees, customs_shipments, or old shipment allocations.
CREATE TABLE IF NOT EXISTS public.international_n1_reconciliations (
  shipment_id uuid PRIMARY KEY REFERENCES public.international_shipments(id) ON DELETE RESTRICT,
  snapshot_hash text NOT NULL CHECK (length(snapshot_hash) = 64),
  total_freight_kmf numeric(14,2) NOT NULL DEFAULT 0,
  total_arrival_kmf numeric(14,2) NOT NULL DEFAULT 0,
  total_local_kmf numeric(14,2) NOT NULL DEFAULT 0,
  allocation_rows integer NOT NULL DEFAULT 0 CHECK (allocation_rows >= 0),
  actor_id text NOT NULL,
  reconciled_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.international_n1_allocation_links (
  allocation_id uuid PRIMARY KEY REFERENCES public.order_item_real_cost_allocations(id) ON DELETE CASCADE,
  shipment_id uuid NOT NULL REFERENCES public.international_shipments(id) ON DELETE RESTRICT,
  component text NOT NULL CHECK (component IN ('freight','port_transitaire','local_distribution')),
  fee_type text NOT NULL DEFAULT '',
  parcel_id uuid NOT NULL REFERENCES public.parcels(id),
  order_item_id uuid NOT NULL REFERENCES public.order_items(id),
  CONSTRAINT uq_international_n1_share UNIQUE(shipment_id,component,fee_type,parcel_id,order_item_id)
);
CREATE INDEX IF NOT EXISTS idx_international_n1_links_shipment
  ON public.international_n1_allocation_links(shipment_id);
COMMENT ON TABLE public.international_n1_reconciliations IS
  'Idempotent source snapshot of actual international N1; never forecasts or N3.';
COMMENT ON TABLE public.international_n1_allocation_links IS
  'Ownership of N1 allocations by international freight/fee projection; legacy customs allocator must not delete these rows.';
-- Guard the reverse write path too: a later legacy customs entry cannot
-- silently duplicate a shipment cost that has already entered canonical N1.
CREATE OR REPLACE FUNCTION public.guard_international_n1_against_legacy_duplicate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'customs_shipments' THEN
    IF NEW.freight_kmf IS NOT NULL AND NEW.freight_kmf > 0 AND EXISTS (
      SELECT 1 FROM public.international_shipments s
      JOIN public.international_n1_reconciliations n ON n.shipment_id=s.id
      WHERE s.customs_shipment_id=NEW.id AND s.freight_invoice_kmf > 0
    ) THEN
      RAISE EXCEPTION 'INTERNATIONAL_N1_DUPLICATE_FREIGHT'
        USING ERRCODE='check_violation';
    END IF;
  ELSIF TG_TABLE_NAME = 'customs_shipment_fees' THEN
    IF EXISTS (
      SELECT 1 FROM public.international_shipments s
      JOIN public.international_n1_reconciliations n ON n.shipment_id=s.id
      WHERE s.customs_shipment_id=NEW.shipment_id
        AND (
          EXISTS (SELECT 1 FROM public.international_shipment_charges c
                  WHERE c.shipment_id=s.id AND
                    (c.fee_type=NEW.fee_type OR lower(btrim(c.proof_ref))=lower(btrim(NEW.proof_ref))))
          OR lower(btrim(COALESCE(s.freight_invoice_ref,'')))=lower(btrim(NEW.proof_ref))
        )
    ) THEN
      RAISE EXCEPTION 'INTERNATIONAL_N1_DUPLICATE_FEE'
        USING ERRCODE='check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_customs_freight_after_international_n1 ON public.customs_shipments;
CREATE TRIGGER guard_customs_freight_after_international_n1
  BEFORE UPDATE OF freight_kmf ON public.customs_shipments
  FOR EACH ROW EXECUTE FUNCTION public.guard_international_n1_against_legacy_duplicate();
DROP TRIGGER IF EXISTS guard_customs_fee_after_international_n1 ON public.customs_shipment_fees;
CREATE TRIGGER guard_customs_fee_after_international_n1
  BEFORE INSERT ON public.customs_shipment_fees
  FOR EACH ROW EXECUTE FUNCTION public.guard_international_n1_against_legacy_duplicate();
