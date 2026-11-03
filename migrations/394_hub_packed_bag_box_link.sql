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


CREATE OR REPLACE FUNCTION public.hub_guard_physical_unit_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  active_count integer;
  market_count integer;
  destination_count integer;
  resolved_market_id uuid;
  resolved_destination_ref text;
  transition_ok boolean;
  resume_state text;
BEGIN
  IF OLD.market_id IS NOT NULL AND NEW.market_id IS DISTINCT FROM OLD.market_id THEN
    RAISE EXCEPTION 'hub_physical_unit_market_immutable';
  END IF;

  IF OLD.outcome_type IS NOT NULL AND NEW.outcome_type IS DISTINCT FROM OLD.outcome_type THEN
    RAISE EXCEPTION 'hub_physical_outcome_immutable';
  END IF;

  IF NEW.market_id IS DISTINCT FROM OLD.market_id
     AND NEW.state NOT IN ('PACKED', 'DISPATCHED') THEN
    RAISE EXCEPTION 'hub_market_only_derived_at_outbound';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF OLD.state = 'QUARANTINED' THEN
      IF OLD.outcome_type IS NOT NULL THEN
        RAISE EXCEPTION 'hub_destructive_outcome_quarantine_terminal';
      END IF;

      IF EXISTS (
        SELECT 1
          FROM incidents i
         WHERE i.status IN ('open', 'investigating')
           AND i.details->>'physical_unit_id' = OLD.id::text
      ) THEN
        RAISE EXCEPTION 'hub_quarantine_incident_active';
      END IF;

      SELECT COALESCE(NULLIF(e.from_state, 'QUARANTINED'), 'RECEIVED')
        INTO resume_state
        FROM hub_custody_events e
       WHERE e.physical_unit_id = OLD.id
         AND e.event_type = 'QUARANTINE'
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT 1;

      resume_state := COALESCE(resume_state, 'RECEIVED');
      transition_ok := NEW.state = resume_state;
    ELSE
      transition_ok := CASE OLD.state
        WHEN 'RECEIVED'        THEN NEW.state IN ('IDENTIFIED', 'QUARANTINED', 'SUPERSEDED')
        WHEN 'IDENTIFIED'      THEN NEW.state IN ('QUALITY_CHECKED', 'QUARANTINED', 'SUPERSEDED')
        WHEN 'QUALITY_CHECKED' THEN NEW.state IN ('LOCATED', 'QUARANTINED', 'SUPERSEDED')
        WHEN 'LOCATED'         THEN NEW.state IN ('ALLOCATED', 'QUARANTINED', 'SUPERSEDED')
        WHEN 'ALLOCATED'       THEN NEW.state IN ('PICKED', 'QUARANTINED', 'SUPERSEDED')
        WHEN 'PICKED'          THEN NEW.state IN ('PACKED', 'QUARANTINED', 'SUPERSEDED')
        WHEN 'PACKED'          THEN NEW.state IN ('DISPATCHED', 'QUARANTINED')
        WHEN 'DISPATCHED'      THEN NEW.state = 'QUARANTINED'
        ELSE false
      END;
    END IF;

    IF NOT transition_ok THEN
      RAISE EXCEPTION 'hub_physical_state_transition_invalid:%->%', OLD.state, NEW.state;
    END IF;
  END IF;

  IF NEW.state IN ('PACKED', 'DISPATCHED') THEN
    SELECT COUNT(*)::integer,
           COUNT(DISTINCT a.market_id)::integer,
           COUNT(DISTINCT a.destination_ref)::integer,
           MIN(a.market_id::text)::uuid,
           MIN(a.destination_ref)
      INTO active_count, market_count, destination_count, resolved_market_id, resolved_destination_ref
      FROM (
        SELECT p.allocation_id, p.quantity
          FROM hub_physical_unit_placements p
         WHERE NEW.unit_type = 'HANDLING_UNIT'
           AND p.physical_unit_id = NEW.id AND p.removed_at IS NULL
        UNION ALL
        SELECT p.allocation_id, p.quantity
          FROM hub_box_effective_placements p
         WHERE NEW.unit_type = 'MARKET_PARCEL' AND p.box_unit_id = NEW.id
      ) p
      JOIN hub_purchase_allocations a ON a.id = p.allocation_id;

    IF active_count = 0 THEN
      RAISE EXCEPTION 'hub_outbound_unit_empty';
    END IF;
    IF market_count <> 1 THEN
      RAISE EXCEPTION 'hub_outbound_market_not_homogeneous';
    END IF;
    IF destination_count <> 1 OR resolved_destination_ref IS NULL THEN
      RAISE EXCEPTION 'hub_outbound_destination_not_homogeneous';
    END IF;
    IF NEW.market_id IS NOT NULL AND NEW.market_id IS DISTINCT FROM resolved_market_id THEN
      RAISE EXCEPTION 'hub_outbound_market_snapshot_mismatch';
    END IF;

    NEW.market_id := resolved_market_id;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


-- Tous les compteurs lisent la composition effective de la KOM-BOX.
-- Le sac garde ses placements actifs ; il n'est jamais vidé par un MOVE fictif.
CREATE OR REPLACE FUNCTION public.hub_item_handed_over(p_order_item_id uuid)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(p.quantity), 0)::integer
    FROM public.hub_box_effective_placements p
    JOIN public.hub_purchase_allocations a ON a.id = p.allocation_id
    JOIN public.international_shipment_hub_units h ON h.physical_unit_id = p.box_unit_id
    JOIN public.international_shipments s ON s.id = h.shipment_id
   WHERE a.order_item_id = p_order_item_id
     AND s.stage <> 'hub_ready';
$$;

CREATE OR REPLACE FUNCTION public.hub_item_physical_proof(
  p_order_item_id uuid, OUT received integer, OUT boxed integer
) RETURNS record LANGUAGE plpgsql STABLE AS $$
BEGIN
  SELECT COALESCE(SUM(p.quantity), 0)::integer INTO received
    FROM public.hub_physical_unit_placements p
    JOIN public.hub_purchase_allocations a ON a.id = p.allocation_id
   WHERE a.order_item_id = p_order_item_id AND p.operation_type = 'RECEIVE';

  SELECT COALESCE(SUM(p.quantity), 0)::integer INTO boxed
    FROM public.hub_box_effective_placements p
    JOIN public.hub_purchase_allocations a ON a.id = p.allocation_id
   WHERE a.order_item_id = p_order_item_id;
END $$;


-- Lorsqu'un sac est ajouté à une KOM-BOX, la quantité "emballée" du colis client
-- est recalculée depuis la nouvelle preuve physique, pas déclarée par l'agent.
CREATE OR REPLACE FUNCTION public.sync_parcel_items_on_bag_box_link()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_item uuid;
BEGIN
  FOR v_item IN
    SELECT DISTINCT a.order_item_id
      FROM public.hub_physical_unit_placements p
      JOIN public.hub_purchase_allocations a ON a.id=p.allocation_id
     WHERE p.physical_unit_id=NEW.bag_unit_id AND p.removed_at IS NULL
  LOOP
    PERFORM public.sync_parcel_items_from_physical(v_item);
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_sync_parcel_items_on_bag_box_link
  AFTER INSERT ON public.hub_box_bags
  FOR EACH ROW EXECUTE FUNCTION public.sync_parcel_items_on_bag_box_link();

CREATE OR REPLACE FUNCTION public.sync_parcel_items_on_shipment_stage()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_item uuid;
BEGIN
  FOR v_item IN
    SELECT DISTINCT a.order_item_id
      FROM public.international_shipment_hub_units h
      JOIN public.hub_box_effective_placements p ON p.box_unit_id=h.physical_unit_id
      JOIN public.hub_purchase_allocations a ON a.id=p.allocation_id
     WHERE h.shipment_id=NEW.id
  LOOP
    PERFORM public.sync_parcel_items_from_physical(v_item);
  END LOOP;
  RETURN NULL;
END $$;
