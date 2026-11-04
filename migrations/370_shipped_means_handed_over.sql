-- 370 — « Expédié » = physiquement remis au transitaire (P0-2). Pour un article d'import, qty_shipped ne peut plus être
-- posé par un scan Hub : il est DÉRIVÉ des KOM-BOX rattachées à une expédition internationale qui a dépassé hub_ready
-- (remise au transitaire effective). Un carton seulement rattaché à une expédition en hub_ready n'est pas expédié.

CREATE OR REPLACE FUNCTION public.hub_item_handed_over(p_order_item_id uuid) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(p.quantity), 0)::integer
    FROM public.hub_physical_unit_placements p
    JOIN public.hub_purchase_allocations a ON a.id = p.allocation_id
    JOIN public.hub_physical_units u ON u.id = p.physical_unit_id AND u.unit_type = 'MARKET_PARCEL'
    JOIN public.international_shipment_hub_units h ON h.physical_unit_id = u.id
    JOIN public.international_shipments s ON s.id = h.shipment_id
   WHERE a.order_item_id = p_order_item_id
     AND p.removed_at IS NULL
     AND s.stage <> 'hub_ready';
$$;

-- Garde : expédié (import) <= remis au transitaire, toutes lignes de colis confondues.
CREATE OR REPLACE FUNCTION public.parcel_items_guard_handed_over() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_source text; v_other integer; v_handed integer;
BEGIN
  IF NEW.qty_shipped = 0 THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.qty_shipped = OLD.qty_shipped THEN RETURN NEW; END IF;
  SELECT fulfillment_source INTO v_source FROM public.order_items WHERE id = NEW.order_item_id;
  IF v_source IS DISTINCT FROM 'IMPORT' THEN RETURN NEW; END IF;
  SELECT COALESCE(SUM(pi.qty_shipped), 0) INTO v_other
    FROM public.parcel_items pi JOIN public.parcels pa ON pa.id = pi.parcel_id
   WHERE pi.order_item_id = NEW.order_item_id AND pi.id <> NEW.id AND pa.cancelled_at IS NULL;
  v_handed := public.hub_item_handed_over(NEW.order_item_id);
  IF v_other + NEW.qty_shipped > v_handed THEN
    RAISE EXCEPTION 'parcel_item_not_handed_over: qty_shipped % > remis au transitaire % pour l''article %', v_other + NEW.qty_shipped, v_handed, NEW.order_item_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_parcel_items_handed_over ON public.parcel_items;
CREATE TRIGGER trg_parcel_items_handed_over
  BEFORE INSERT OR UPDATE OF qty_shipped ON public.parcel_items
  FOR EACH ROW EXECUTE FUNCTION public.parcel_items_guard_handed_over();

-- Dérivation : allocation/emballage (363) + expédié = min(emballé, remis), réparti du plus ancien au plus récent.
CREATE OR REPLACE FUNCTION public.sync_parcel_items_from_physical(p_order_item_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_received integer; v_boxed integer; v_handed integer;
  v_a integer; v_b integer; v_h integer; v_na integer; v_nb integer; v_ns integer; r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.order_items WHERE id = p_order_item_id AND fulfillment_source = 'IMPORT') THEN RETURN; END IF;
  SELECT received, boxed INTO v_received, v_boxed FROM public.hub_item_physical_proof(p_order_item_id);
  v_handed := public.hub_item_handed_over(p_order_item_id);
  v_a := v_received; v_b := v_boxed; v_h := v_handed;
  FOR r IN
    SELECT pi.id, pi.quantity, pi.qty_allocated, pi.qty_packed, pi.qty_shipped
      FROM public.parcel_items pi JOIN public.parcels pa ON pa.id = pi.parcel_id
     WHERE pi.order_item_id = p_order_item_id AND pa.cancelled_at IS NULL
     ORDER BY pi.created_at, pi.id
       FOR UPDATE OF pi
  LOOP
    v_na := LEAST(r.quantity, v_a);
    v_nb := LEAST(v_na, v_b);
    v_ns := LEAST(v_nb, v_h);
    v_a := v_a - v_na;
    v_b := v_b - v_nb;
    v_h := v_h - v_ns;
    IF v_nb < r.qty_shipped THEN CONTINUE; END IF; -- déjà expédié : la preuve passée ne se réécrit pas
    IF v_ns < r.qty_shipped THEN v_ns := r.qty_shipped; END IF;
    IF v_na <> r.qty_allocated OR v_nb <> r.qty_packed OR v_ns <> r.qty_shipped THEN
      UPDATE public.parcel_items SET qty_allocated = v_na, qty_packed = v_nb, qty_shipped = v_ns WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

-- À la remise au transitaire (ou tout changement d'étape), les colis clients des articles concernés sont recalculés.
CREATE OR REPLACE FUNCTION public.sync_parcel_items_on_shipment_stage() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_item uuid;
BEGIN
  FOR v_item IN
    SELECT DISTINCT a.order_item_id
      FROM public.international_shipment_hub_units h
      JOIN public.hub_physical_unit_placements p ON p.physical_unit_id = h.physical_unit_id
      JOIN public.hub_purchase_allocations a ON a.id = p.allocation_id
     WHERE h.shipment_id = NEW.id AND p.removed_at IS NULL
  LOOP
    PERFORM public.sync_parcel_items_from_physical(v_item);
  END LOOP;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_sync_parcel_items_on_shipment_stage ON public.international_shipments;
CREATE TRIGGER trg_sync_parcel_items_on_shipment_stage
  AFTER UPDATE OF stage ON public.international_shipments
  FOR EACH ROW WHEN (OLD.stage IS DISTINCT FROM NEW.stage)
  EXECUTE FUNCTION public.sync_parcel_items_on_shipment_stage();

-- Nettoyage staging : un expédié sans remise effective est ramené à ce qui est réellement parti.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT pi.order_item_id
             FROM public.parcel_items pi JOIN public.order_items oi ON oi.id = pi.order_item_id
            WHERE oi.fulfillment_source = 'IMPORT' AND pi.qty_shipped > 0 AND pi.qty_received = 0
  LOOP
    UPDATE public.parcel_items SET qty_shipped = 0
     WHERE order_item_id = r.order_item_id AND qty_received = 0
       AND public.hub_item_handed_over(r.order_item_id) = 0;
  END LOOP;
END $$;
