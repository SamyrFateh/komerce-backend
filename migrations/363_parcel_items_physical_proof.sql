-- 363 — Une seule vérité physique : un article d'import ne peut être « affecté » (qty_allocated) qu'à hauteur de ce que le
-- Hub a réellement reçu, et « emballé » (qty_packed) qu'à hauteur de ce qui est placé dans une KOM-BOX (MARKET_PARCEL).
-- La chaîne packed >= shipped >= received >= collected reste portée par trg_check_parcel_item_qty : expédié <= placé.
-- Les quantités du colis client sont DÉRIVÉES des placements physiques (trigger sur hub_physical_unit_placements),
-- jamais préremplies. Les articles hors import (stock local) ne sont pas concernés (circuit direct relais).

CREATE OR REPLACE FUNCTION public.hub_item_physical_proof(p_order_item_id uuid, OUT received integer, OUT boxed integer)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  SELECT COALESCE(SUM(p.quantity), 0)::integer INTO received
    FROM public.hub_physical_unit_placements p
    JOIN public.hub_purchase_allocations a ON a.id = p.allocation_id
   WHERE a.order_item_id = p_order_item_id AND p.operation_type = 'RECEIVE';
  SELECT COALESCE(SUM(p.quantity), 0)::integer INTO boxed
    FROM public.hub_physical_unit_placements p
    JOIN public.hub_purchase_allocations a ON a.id = p.allocation_id
    JOIN public.hub_physical_units u ON u.id = p.physical_unit_id
   WHERE a.order_item_id = p_order_item_id AND p.removed_at IS NULL AND u.unit_type = 'MARKET_PARCEL';
END $$;

CREATE OR REPLACE FUNCTION public.parcel_items_guard_physical_proof() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_source text; v_received integer; v_boxed integer; v_other_alloc integer; v_other_packed integer;
BEGIN
  IF NEW.qty_allocated = 0 AND NEW.qty_packed = 0 THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.qty_allocated = OLD.qty_allocated AND NEW.qty_packed = OLD.qty_packed THEN RETURN NEW; END IF;
  SELECT fulfillment_source INTO v_source FROM public.order_items WHERE id = NEW.order_item_id;
  IF v_source IS DISTINCT FROM 'IMPORT' THEN RETURN NEW; END IF;
  SELECT received, boxed INTO v_received, v_boxed FROM public.hub_item_physical_proof(NEW.order_item_id);
  SELECT COALESCE(SUM(pi.qty_allocated), 0), COALESCE(SUM(pi.qty_packed), 0)
    INTO v_other_alloc, v_other_packed
    FROM public.parcel_items pi JOIN public.parcels pa ON pa.id = pi.parcel_id
   WHERE pi.order_item_id = NEW.order_item_id AND pi.id <> NEW.id AND pa.cancelled_at IS NULL;
  IF v_other_alloc + NEW.qty_allocated > v_received THEN
    RAISE EXCEPTION 'parcel_item_no_physical_proof: qty_allocated % > reçu au Hub % pour l''article %', v_other_alloc + NEW.qty_allocated, v_received, NEW.order_item_id
      USING ERRCODE = '23514';
  END IF;
  IF v_other_packed + NEW.qty_packed > v_boxed THEN
    RAISE EXCEPTION 'parcel_item_no_physical_proof: qty_packed % > placé en KOM-BOX % pour l''article %', v_other_packed + NEW.qty_packed, v_boxed, NEW.order_item_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_parcel_items_physical_proof ON public.parcel_items;
CREATE TRIGGER trg_parcel_items_physical_proof
  BEFORE INSERT OR UPDATE OF qty_allocated, qty_packed ON public.parcel_items
  FOR EACH ROW EXECUTE FUNCTION public.parcel_items_guard_physical_proof();

-- Dérivation : répartit le reçu / le placé en KOM-BOX sur les lignes de colis client de l'article (plus ancien d'abord).
CREATE OR REPLACE FUNCTION public.sync_parcel_items_from_physical(p_order_item_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_received integer; v_boxed integer; v_a integer; v_b integer; v_na integer; v_nb integer; r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.order_items WHERE id = p_order_item_id AND fulfillment_source = 'IMPORT') THEN RETURN; END IF;
  SELECT received, boxed INTO v_received, v_boxed FROM public.hub_item_physical_proof(p_order_item_id);
  v_a := v_received; v_b := v_boxed;
  FOR r IN
    SELECT pi.id, pi.quantity, pi.qty_allocated, pi.qty_packed, pi.qty_shipped
      FROM public.parcel_items pi JOIN public.parcels pa ON pa.id = pi.parcel_id
     WHERE pi.order_item_id = p_order_item_id AND pa.cancelled_at IS NULL
     ORDER BY pi.created_at, pi.id
       FOR UPDATE OF pi
  LOOP
    v_na := LEAST(r.quantity, v_a);
    v_nb := LEAST(v_na, v_b);
    v_a := v_a - v_na;
    v_b := v_b - v_nb;
    IF v_nb < r.qty_shipped THEN CONTINUE; END IF; -- déjà expédié : la preuve passée ne se réécrit pas
    IF v_na <> r.qty_allocated OR v_nb <> r.qty_packed THEN
      UPDATE public.parcel_items SET qty_allocated = v_na, qty_packed = v_nb WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.sync_parcel_items_on_placement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_item uuid;
BEGIN
  SELECT order_item_id INTO v_item FROM public.hub_purchase_allocations WHERE id = NEW.allocation_id;
  IF v_item IS NOT NULL THEN PERFORM public.sync_parcel_items_from_physical(v_item); END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_sync_parcel_items_on_placement ON public.hub_physical_unit_placements;
CREATE TRIGGER trg_sync_parcel_items_on_placement
  AFTER INSERT OR UPDATE OF removed_at ON public.hub_physical_unit_placements
  FOR EACH ROW EXECUTE FUNCTION public.sync_parcel_items_on_placement();

CREATE OR REPLACE FUNCTION public.sync_parcel_items_on_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.sync_parcel_items_from_physical(NEW.order_item_id);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_sync_parcel_items_on_insert ON public.parcel_items;
CREATE TRIGGER trg_sync_parcel_items_on_insert
  AFTER INSERT ON public.parcel_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_parcel_items_on_insert();

-- Nettoyage staging : les quantités préremplies sans preuve physique sont remises à ce que le Hub atteste.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT pi.order_item_id
             FROM public.parcel_items pi JOIN public.order_items oi ON oi.id = pi.order_item_id
            WHERE oi.fulfillment_source = 'IMPORT' AND pi.qty_shipped = 0 AND (pi.qty_allocated > 0 OR pi.qty_packed > 0)
  LOOP
    UPDATE public.parcel_items SET qty_allocated = 0, qty_packed = 0
     WHERE order_item_id = r.order_item_id AND qty_shipped = 0;
    PERFORM public.sync_parcel_items_from_physical(r.order_item_id);
  END LOOP;
END $$;
