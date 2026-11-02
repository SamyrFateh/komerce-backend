-- 364 — Réception relais constatée PAR LE RELAIS, article par article.
-- Un relais atteste, pour une expédition, ce qu'il a réellement reçu par article de commande (attendu = placé en KOM-BOX
-- de l'expédition). L'étape relay_received de l'expédition n'est plus posée par Hub/admin : elle découle des
-- attestations de tous les relais concernés. Un écart (manquant/excédent) ouvre un incident traçable (table incidents).
CREATE TABLE IF NOT EXISTS public.international_shipment_relay_receipts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id     uuid NOT NULL REFERENCES public.international_shipments(id) ON DELETE RESTRICT,
  order_item_id   uuid NOT NULL REFERENCES public.order_items(id) ON DELETE RESTRICT,
  relais_id       uuid NOT NULL REFERENCES public.relais(id) ON DELETE RESTRICT,
  expected_qty    integer NOT NULL CHECK (expected_qty > 0),
  received_qty    integer NOT NULL CHECK (received_qty >= 0),
  received_by     uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  proof_ref       text NOT NULL CHECK (btrim(proof_ref) <> ''),
  incident_id     uuid NULL REFERENCES public.incidents(id) ON DELETE SET NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_shipment_relay_receipt UNIQUE (shipment_id, order_item_id)
);
CREATE INDEX IF NOT EXISTS idx_shipment_relay_receipts_relais ON public.international_shipment_relay_receipts (relais_id, shipment_id);

CREATE OR REPLACE FUNCTION public.shipment_relay_receipts_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR NEW.shipment_id IS DISTINCT FROM OLD.shipment_id OR NEW.order_item_id IS DISTINCT FROM OLD.order_item_id
     OR NEW.relais_id IS DISTINCT FROM OLD.relais_id OR NEW.expected_qty IS DISTINCT FROM OLD.expected_qty
     OR NEW.received_qty IS DISTINCT FROM OLD.received_qty OR NEW.proof_ref IS DISTINCT FROM OLD.proof_ref
     OR NEW.received_at IS DISTINCT FROM OLD.received_at THEN
    RAISE EXCEPTION 'shipment_relay_receipt_immutable: une attestation de réception relais ne se modifie ni ne se supprime' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_shipment_relay_receipts_immutable ON public.international_shipment_relay_receipts;
CREATE TRIGGER trg_shipment_relay_receipts_immutable
  BEFORE UPDATE OR DELETE ON public.international_shipment_relay_receipts
  FOR EACH ROW EXECUTE FUNCTION public.shipment_relay_receipts_immutable();
