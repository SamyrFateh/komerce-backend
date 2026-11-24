-- @migration 428_hub_box_custody_scans.sql
-- @domain logistics
-- @purpose Per-COMBOX custody proof: Hub handover, carrier acceptance, loading.
-- These proofs are immutable; scanning does not by itself transition a shipment.
CREATE TABLE IF NOT EXISTS public.hub_box_custody_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES public.international_shipments(id) ON DELETE RESTRICT,
  box_unit_id uuid NOT NULL REFERENCES public.hub_physical_units(id) ON DELETE RESTRICT,
  label_id uuid NOT NULL REFERENCES public.hub_scan_labels(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK(event_type IN ('HUB_HANDOVER','CARRIER_ACCEPTED','CARRIER_LOADED')),
  actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  proof_ref text NOT NULL CHECK (length(btrim(proof_ref)) BETWEEN 3 AND 240),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_hub_box_custody_stage UNIQUE(shipment_id,box_unit_id,event_type)
);
CREATE INDEX IF NOT EXISTS idx_hub_box_custody_shipment
  ON public.hub_box_custody_scans(shipment_id,event_type,occurred_at);
DROP TRIGGER IF EXISTS hub_box_custody_scans_immutable ON public.hub_box_custody_scans;
CREATE TRIGGER hub_box_custody_scans_immutable
  BEFORE UPDATE OR DELETE ON public.hub_box_custody_scans
  FOR EACH ROW EXECUTE FUNCTION public.international_facts_immutable();
COMMENT ON TABLE public.hub_box_custody_scans IS
  'One authenticated, explicitly confirmed QR scan per COMBOX and custody event; not a shipment transition.';
