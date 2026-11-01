-- 358 — Hub P0 (#3247) : preuve de transmission d'une PO et rattachement KOM-BOX → expédition.
--
-- 1. Une PO soumise (status 'notified') n'est qu'un bon émis : un lien WhatsApp généré
--    n'est pas une preuve d'envoi. L'envoi réellement effectué est un fait distinct,
--    enregistré une seule fois avec son canal, son auteur et son horodatage.
-- 2. Un carton marché (hub_physical_units MARKET_PARCEL, « KOM-BOX ») appartient à au plus
--    une expédition internationale du même marché, rattaché tant que l'expédition est au Hub.

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_channel text,
  ADD COLUMN IF NOT EXISTS sent_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS sent_note text;

ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS chk_purchase_orders_sent_proof;
ALTER TABLE public.purchase_orders ADD CONSTRAINT chk_purchase_orders_sent_proof CHECK (
  (sent_at IS NULL AND sent_channel IS NULL AND sent_by IS NULL)
  OR (sent_at IS NOT NULL AND sent_channel IS NOT NULL AND sent_channel IN ('email','whatsapp','phone','api','other'))
);

CREATE OR REPLACE FUNCTION public.purchase_orders_guard_sent_proof()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.sent_at IS NOT NULL AND (
       NEW.sent_at IS DISTINCT FROM OLD.sent_at
    OR NEW.sent_channel IS DISTINCT FROM OLD.sent_channel
    OR NEW.sent_by IS DISTINCT FROM OLD.sent_by) THEN
    RAISE EXCEPTION 'purchase_order_sent_proof_immutable: envoi déjà enregistré'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.sent_at IS NULL AND NEW.sent_at IS NOT NULL
     AND NEW.status NOT IN ('notified','confirmed','shipped','hub_received') THEN
    RAISE EXCEPTION 'purchase_order_sent_requires_submitted: seule une PO soumise peut être envoyée'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_purchase_orders_sent_proof ON public.purchase_orders;
CREATE TRIGGER trg_purchase_orders_sent_proof
  BEFORE UPDATE OF sent_at, sent_channel, sent_by ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.purchase_orders_guard_sent_proof();

COMMENT ON COLUMN public.purchase_orders.sent_at IS
  'Envoi réellement effectué au fournisseur (déclaré par un opérateur ou un adaptateur API). NULL = bon préparé ou émis, transmission non prouvée.';

CREATE TABLE IF NOT EXISTS public.international_shipment_hub_units (
  shipment_id uuid NOT NULL REFERENCES public.international_shipments(id) ON DELETE RESTRICT,
  physical_unit_id uuid NOT NULL REFERENCES public.hub_physical_units(id) ON DELETE RESTRICT,
  attached_by uuid NULL REFERENCES public.users(id),
  attached_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shipment_id, physical_unit_id),
  -- Un carton réel ne peut pas appartenir à deux expéditions.
  CONSTRAINT uq_international_shipment_hub_unit UNIQUE (physical_unit_id)
);
CREATE INDEX IF NOT EXISTS idx_international_shipment_hub_units_shipment
  ON public.international_shipment_hub_units(shipment_id);

CREATE OR REPLACE FUNCTION public.international_shipment_hub_units_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_unit record;
  v_shipment record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT stage INTO v_shipment FROM public.international_shipments WHERE id = OLD.shipment_id FOR UPDATE;
    IF v_shipment.stage IS DISTINCT FROM 'hub_ready' THEN
      RAISE EXCEPTION 'hub_box_shipment_detach_after_handover' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'hub_box_shipment_link_immutable' USING ERRCODE = '23514';
  END IF;

  SELECT id, unit_type, state, market_id INTO v_unit
    FROM public.hub_physical_units WHERE id = NEW.physical_unit_id FOR UPDATE;
  SELECT id, market_id, stage INTO v_shipment
    FROM public.international_shipments WHERE id = NEW.shipment_id FOR UPDATE;
  IF v_unit.unit_type IS DISTINCT FROM 'MARKET_PARCEL' THEN
    RAISE EXCEPTION 'hub_box_shipment_requires_market_parcel' USING ERRCODE = '23514';
  END IF;
  IF v_unit.state NOT IN ('PACKED','DISPATCHED') OR v_unit.market_id IS NULL THEN
    RAISE EXCEPTION 'hub_box_shipment_requires_packed_box' USING ERRCODE = '23514';
  END IF;
  IF v_shipment.market_id IS DISTINCT FROM v_unit.market_id THEN
    RAISE EXCEPTION 'hub_box_shipment_market_mismatch: carton et expédition de marchés différents'
      USING ERRCODE = '23514';
  END IF;
  IF v_shipment.stage IS DISTINCT FROM 'hub_ready' THEN
    RAISE EXCEPTION 'hub_box_shipment_closed: expédition déjà remise au transitaire'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_international_shipment_hub_units_guard ON public.international_shipment_hub_units;
CREATE TRIGGER trg_international_shipment_hub_units_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.international_shipment_hub_units
  FOR EACH ROW EXECUTE FUNCTION public.international_shipment_hub_units_guard();
