-- @migration 392_hub_order_bag_ownership.sql
-- #3329 / M6 : le sac client est un HANDLING_UNIT mono-commande.
-- Une allocation appartient deja immuablement a une commande via hub_purchase_allocations.order_id.
ALTER TABLE public.hub_physical_units
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.orders(id) ON DELETE RESTRICT;

ALTER TABLE public.hub_physical_units
  DROP CONSTRAINT IF EXISTS hub_order_bag_type_check;
ALTER TABLE public.hub_physical_units
  ADD CONSTRAINT hub_order_bag_type_check
  CHECK (order_id IS NULL OR unit_type = 'HANDLING_UNIT');

CREATE INDEX IF NOT EXISTS ix_hub_physical_units_order_bag
  ON public.hub_physical_units(order_id) WHERE order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.hub_order_bag_ownership_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.order_id IS NOT NULL AND NEW.unit_type <> 'HANDLING_UNIT' THEN
    RAISE EXCEPTION 'HUB_ORDER_BAG_REQUIRES_HANDLING_UNIT' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.order_id IS NOT NULL AND NEW.order_id IS DISTINCT FROM OLD.order_id THEN
    RAISE EXCEPTION 'HUB_ORDER_BAG_OWNER_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_hub_order_bag_ownership_guard ON public.hub_physical_units;
CREATE TRIGGER trg_hub_order_bag_ownership_guard
  BEFORE INSERT OR UPDATE OF order_id, unit_type ON public.hub_physical_units
  FOR EACH ROW EXECUTE FUNCTION public.hub_order_bag_ownership_guard();

-- Defense at DB boundary: no direct SQL, legacy route, replay or concurrent worker
-- may deposit an allocation belonging to a different customer into the bag.
CREATE OR REPLACE FUNCTION public.hub_order_bag_placement_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_bag_order uuid;
  v_allocation_order uuid;
BEGIN
  SELECT u.order_id INTO v_bag_order
    FROM public.hub_physical_units u
   WHERE u.id = NEW.physical_unit_id AND u.unit_type = 'HANDLING_UNIT';

  IF v_bag_order IS NOT NULL THEN
    SELECT a.order_id INTO v_allocation_order
      FROM public.hub_purchase_allocations a WHERE a.id = NEW.allocation_id;
    IF v_allocation_order IS DISTINCT FROM v_bag_order THEN
      RAISE EXCEPTION 'HUB_ORDER_BAG_ALLOCATION_MISMATCH' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_hub_order_bag_placement_guard ON public.hub_physical_unit_placements;
CREATE TRIGGER trg_hub_order_bag_placement_guard
  BEFORE INSERT OR UPDATE OF physical_unit_id, allocation_id
  ON public.hub_physical_unit_placements
  FOR EACH ROW EXECUTE FUNCTION public.hub_order_bag_placement_guard();
