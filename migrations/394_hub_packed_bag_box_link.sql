-- @migration 394_hub_packed_bag_box_link.sql
-- #3329 / M7 — une KOM-BOX contient des sacs clients fermes, pas des produits
-- "repackes" une seconde fois. L'identite et le contenu du sac sont conserves.
CREATE TABLE public.hub_box_bags (
  bag_unit_id uuid PRIMARY KEY REFERENCES public.hub_physical_units(id) ON DELETE RESTRICT,
  box_unit_id uuid NOT NULL REFERENCES public.hub_physical_units(id) ON DELETE RESTRICT,
  parcel_id uuid NOT NULL REFERENCES public.parcels(id) ON DELETE RESTRICT,
  linked_by uuid NOT NULL REFERENCES public.users(id),
  bag_reference_scan text NOT NULL CHECK (btrim(bag_reference_scan) <> ''),
  box_reference_scan text NOT NULL CHECK (btrim(box_reference_scan) <> ''),
  linked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hub_box_bags_different_units CHECK (bag_unit_id <> box_unit_id)
);
CREATE INDEX ix_hub_box_bags_box ON public.hub_box_bags(box_unit_id);
CREATE INDEX ix_hub_box_bags_parcel ON public.hub_box_bags(parcel_id);

CREATE OR REPLACE FUNCTION public.hub_box_bag_link_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_bag public.hub_physical_units%ROWTYPE;
  v_box public.hub_physical_units%ROWTYPE;
  v_parcel_order uuid;
  v_market uuid;
  v_dest text;
BEGIN
  SELECT * INTO v_bag FROM public.hub_physical_units WHERE id=NEW.bag_unit_id FOR UPDATE;
  SELECT * INTO v_box FROM public.hub_physical_units WHERE id=NEW.box_unit_id FOR UPDATE;
  IF v_bag.id IS NULL OR v_bag.unit_type <> 'HANDLING_UNIT'
     OR v_bag.order_id IS NULL OR v_bag.state <> 'PACKED' OR v_bag.outcome_type IS NOT NULL THEN
    RAISE EXCEPTION 'HUB_BOX_BAG_NOT_PACKED' USING ERRCODE='23514';
  END IF;
  IF v_box.id IS NULL OR v_box.unit_type <> 'MARKET_PARCEL'
     OR v_box.state NOT IN ('RECEIVED','IDENTIFIED','QUALITY_CHECKED','LOCATED','ALLOCATED','PICKED')
     OR v_box.outcome_type IS NOT NULL THEN
    RAISE EXCEPTION 'HUB_BOX_NOT_FILLABLE' USING ERRCODE='23514';
  END IF;
  IF NEW.bag_reference_scan IS DISTINCT FROM v_bag.reference
     OR NEW.box_reference_scan IS DISTINCT FROM v_box.reference THEN
    RAISE EXCEPTION 'HUB_BOX_BAG_SCAN_MISMATCH' USING ERRCODE='23514';
  END IF;

  SELECT p.order_id INTO v_parcel_order FROM public.parcels p
   WHERE p.id=NEW.parcel_id AND p.cancelled_at IS NULL;
  IF v_parcel_order IS DISTINCT FROM v_bag.order_id THEN
    RAISE EXCEPTION 'HUB_BOX_BAG_PARCEL_ORDER_MISMATCH' USING ERRCODE='23514';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.hub_physical_unit_placements p
      JOIN public.hub_purchase_allocations a ON a.id=p.allocation_id
     WHERE p.physical_unit_id=v_bag.id AND p.removed_at IS NULL
       AND NOT EXISTS (
          SELECT 1 FROM public.parcel_items pi WHERE pi.parcel_id=NEW.parcel_id
            AND pi.order_item_id=a.order_item_id
       )
  ) THEN
    RAISE EXCEPTION 'HUB_BOX_BAG_PARCEL_ITEMS_MISMATCH' USING ERRCODE='23514';
  END IF;

  SELECT min(a.market_id::text)::uuid, min(a.destination_ref)
    INTO v_market, v_dest
    FROM public.hub_physical_unit_placements p
    JOIN public.hub_purchase_allocations a ON a.id=p.allocation_id
   WHERE p.physical_unit_id=v_bag.id AND p.removed_at IS NULL;

  IF v_market IS NULL OR v_dest IS NULL
     OR EXISTS (
       SELECT 1 FROM public.hub_physical_unit_placements p
       JOIN public.hub_purchase_allocations a ON a.id=p.allocation_id
       WHERE p.physical_unit_id=v_bag.id AND p.removed_at IS NULL
         AND (a.market_id IS DISTINCT FROM v_market OR a.destination_ref IS DISTINCT FROM v_dest)
     ) THEN
    RAISE EXCEPTION 'HUB_BOX_BAG_CONTENT_NOT_HOMOGENEOUS' USING ERRCODE='23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.hub_physical_unit_placements p
      JOIN public.hub_purchase_allocations a ON a.id=p.allocation_id
     WHERE p.physical_unit_id=v_box.id AND p.removed_at IS NULL
       AND (a.market_id IS DISTINCT FROM v_market OR a.destination_ref IS DISTINCT FROM v_dest)
  ) OR EXISTS (
    SELECT 1 FROM public.hub_box_bags l
      JOIN public.hub_physical_unit_placements p ON p.physical_unit_id=l.bag_unit_id AND p.removed_at IS NULL
      JOIN public.hub_purchase_allocations a ON a.id=p.allocation_id
     WHERE l.box_unit_id=v_box.id
       AND (a.market_id IS DISTINCT FROM v_market OR a.destination_ref IS DISTINCT FROM v_dest)
  ) THEN
    RAISE EXCEPTION 'HUB_BOX_BAG_DESTINATION_MISMATCH' USING ERRCODE='23514';
  END IF;

  IF v_box.market_id IS NOT NULL AND v_box.market_id IS DISTINCT FROM v_market THEN
    RAISE EXCEPTION 'HUB_BOX_BAG_MARKET_MISMATCH' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_hub_box_bag_link_guard
 BEFORE INSERT ON public.hub_box_bags
 FOR EACH ROW EXECUTE FUNCTION public.hub_box_bag_link_guard();

CREATE OR REPLACE FUNCTION public.hub_box_bag_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'HUB_BOX_BAG_LINK_IMMUTABLE' USING ERRCODE='23514';
END $$;
CREATE TRIGGER trg_hub_box_bag_immutable
 BEFORE UPDATE OR DELETE ON public.hub_box_bags
 FOR EACH ROW EXECUTE FUNCTION public.hub_box_bag_immutable();

-- Une seule projection physique : colis vrac (historique) OU sac client scelle
-- contenu dans la KOM-BOX. Pas de MOVE ni de double placement des allocations.
CREATE OR REPLACE VIEW public.hub_box_effective_placements AS
  SELECT p.id AS placement_id, p.physical_unit_id AS box_unit_id,
         NULL::uuid AS bag_unit_id, p.allocation_id, p.quantity
    FROM public.hub_physical_unit_placements p
    JOIN public.hub_physical_units u ON u.id=p.physical_unit_id AND u.unit_type='MARKET_PARCEL'
   WHERE p.removed_at IS NULL
  UNION ALL
  SELECT p.id AS placement_id, l.box_unit_id, l.bag_unit_id, p.allocation_id, p.quantity
    FROM public.hub_box_bags l
    JOIN public.hub_physical_unit_placements p ON p.physical_unit_id=l.bag_unit_id AND p.removed_at IS NULL;
