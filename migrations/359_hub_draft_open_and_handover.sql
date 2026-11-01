-- 359 — Hub #3251 : préparation réversible, remise au transitaire prouvée.
-- Additif : dossiers historiques et identité parcel_refs conservés.
ALTER TABLE public.international_shipments ADD COLUMN IF NOT EXISTS hub_draft boolean NOT NULL DEFAULT FALSE;
ALTER TABLE public.international_shipments
  ALTER COLUMN forwarder_name DROP NOT NULL,
  ALTER COLUMN transport_mode DROP NOT NULL;
ALTER TABLE public.international_shipments DROP CONSTRAINT IF EXISTS chk_international_handover_transport;
ALTER TABLE public.international_shipments ADD CONSTRAINT chk_international_handover_transport
  CHECK (stage = 'hub_ready' OR (forwarder_name IS NOT NULL AND transport_mode IS NOT NULL));

-- L'ouverture et la composition sont des faits auditables, PAS des preuves de remise.
ALTER TABLE public.international_shipment_events ALTER COLUMN proof_ref DROP NOT NULL;
ALTER TABLE public.international_shipment_events
  DROP CONSTRAINT IF EXISTS international_shipment_events_event_type_check,
  DROP CONSTRAINT IF EXISTS international_shipment_events_proof_ref_check;
ALTER TABLE public.international_shipment_events
  ADD CONSTRAINT international_shipment_events_event_type_check CHECK
    (event_type IN ('created','opened','box_attached','box_detached','stage_changed','tracking_updated','freight_recorded','customs_linked')),
  ADD CONSTRAINT chk_international_events_evidence CHECK
    ((event_type IN ('opened','box_attached','box_detached') AND proof_ref IS NULL)
     OR (event_type NOT IN ('opened','box_attached','box_detached')
         AND proof_ref IS NOT NULL AND length(btrim(proof_ref)) > 0));

-- Refus au niveau SQL également si quelqu'un contourne le service pour déclarer la remise.
CREATE OR REPLACE FUNCTION public.international_hub_draft_transfer_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_count integer; v_bad integer;
BEGIN
  IF OLD.stage='hub_ready' AND NEW.stage='handed_over' AND OLD.hub_draft THEN
    SELECT COUNT(*)::int,
      COUNT(*) FILTER (WHERE u.state IS DISTINCT FROM 'DISPATCHED' OR u.outcome_type IS NOT NULL)::int
      INTO v_count,v_bad FROM public.international_shipment_hub_units h
      JOIN public.hub_physical_units u ON u.id=h.physical_unit_id
      WHERE h.shipment_id=OLD.id;
    IF v_count=0 THEN RAISE EXCEPTION 'hub_draft_handover_empty' USING ERRCODE='23514'; END IF;
    IF v_bad>0 THEN RAISE EXCEPTION 'hub_draft_handover_undispatched' USING ERRCODE='23514'; END IF;
    IF NEW.forwarder_name IS NULL OR length(btrim(NEW.forwarder_name))<2 OR NEW.transport_mode IS NULL THEN
      RAISE EXCEPTION 'hub_draft_handover_transport_required' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_international_hub_draft_transfer_guard ON public.international_shipments;
CREATE TRIGGER trg_international_hub_draft_transfer_guard
  BEFORE UPDATE OF stage ON public.international_shipments
  FOR EACH ROW EXECUTE FUNCTION public.international_hub_draft_transfer_guard();

COMMENT ON COLUMN public.international_shipments.hub_draft IS
  'Dossier ouvert en préparation au Hub : transitaire, mode et preuve de remise absents jusqu au transfert réel.';
