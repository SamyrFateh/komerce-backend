-- P0-1 (L3) — L'attestation Relais est la SEULE source de « reçu » pour l'import.
-- parcel_items.qty_received d'un article IMPORT ne peut dépasser la somme des attestations immuables
-- (international_shipment_relay_receipts) : plus aucun scan, route ou rattrapage ne peut « réceptionner » à sa place,
-- et un écart (reçu < attendu) ne peut jamais être écrasé par un scan ultérieur.
CREATE OR REPLACE FUNCTION public.parcel_items_guard_relay_attested() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_source text; v_other integer; v_attested integer;
BEGIN
  IF NEW.qty_received = 0 THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.qty_received = OLD.qty_received THEN RETURN NEW; END IF;
  SELECT fulfillment_source INTO v_source FROM public.order_items WHERE id = NEW.order_item_id;
  IF v_source IS DISTINCT FROM 'IMPORT' THEN RETURN NEW; END IF;
  SELECT COALESCE(SUM(pi.qty_received), 0) INTO v_other
    FROM public.parcel_items pi JOIN public.parcels pa ON pa.id = pi.parcel_id
   WHERE pi.order_item_id = NEW.order_item_id AND pi.id <> NEW.id AND pa.cancelled_at IS NULL;
  SELECT COALESCE(SUM(received_qty), 0) INTO v_attested
    FROM public.international_shipment_relay_receipts WHERE order_item_id = NEW.order_item_id;
  IF v_other + NEW.qty_received > v_attested THEN
    RAISE EXCEPTION 'parcel_item_not_relay_attested: qty_received % > attesté par le relais % pour l''article %', v_other + NEW.qty_received, v_attested, NEW.order_item_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_parcel_items_relay_attested ON public.parcel_items;
CREATE TRIGGER trg_parcel_items_relay_attested
  BEFORE INSERT OR UPDATE OF qty_received ON public.parcel_items
  FOR EACH ROW EXECUTE FUNCTION public.parcel_items_guard_relay_attested();
