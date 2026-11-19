-- 465 · G6-BUYER staging-only recipe release of a PACKED Hub placement.
-- No immutable allocation, custody event, or bag→KOM-BOX link can be deleted.
-- The closed placement remains historical; the custody owner writes the audit.
-- The API opens one transaction, verifies an admin + order scope, then sets
-- LOCAL komerce.g6_recipe_order_id to that exact order UUID.
CREATE OR REPLACE FUNCTION public.hub_guard_placement_update()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  unit_state text;
  cleanup_order text;
BEGIN
  IF NEW.physical_unit_id IS DISTINCT FROM OLD.physical_unit_id
     OR NEW.allocation_id IS DISTINCT FROM OLD.allocation_id
     OR NEW.quantity IS DISTINCT FROM OLD.quantity
     OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
     OR NEW.operation_type IS DISTINCT FROM OLD.operation_type
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.placed_at IS DISTINCT FROM OLD.placed_at THEN
    RAISE EXCEPTION 'hub_placement_identity_immutable';
  END IF;
  IF OLD.removed_at IS NOT NULL OR NEW.removed_at IS NULL THEN
    RAISE EXCEPTION 'hub_placement_close_once';
  END IF;
  IF NEW.removed_at <= OLD.placed_at THEN
    RAISE EXCEPTION 'hub_placement_removed_at_invalid';
  END IF;
  SELECT state INTO unit_state FROM public.hub_physical_units
   WHERE id=OLD.physical_unit_id FOR UPDATE;
  IF unit_state IN ('PACKED','DISPATCHED','QUARANTINED','SUPERSEDED') THEN
    cleanup_order:=current_setting('komerce.g6_recipe_order_id',true);
    IF NOT (
      unit_state='PACKED'
      AND cleanup_order IS NOT NULL
      AND cleanup_order ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND EXISTS (
        SELECT 1 FROM public.hub_purchase_allocations a
        JOIN public.orders o ON o.id=a.order_id
        WHERE a.id=OLD.allocation_id
          AND a.order_id::text=cleanup_order
          AND o.simulation_scope='G6-BUYER'
          AND o.payment_mode='cash_relais'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.international_shipment_hub_units h
        WHERE h.physical_unit_id=OLD.physical_unit_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.hub_box_bags l
        JOIN public.international_shipment_hub_units h ON h.physical_unit_id=l.box_unit_id
        WHERE l.bag_unit_id=OLD.physical_unit_id
      )
    ) THEN
      RAISE EXCEPTION 'hub_physical_unit_content_frozen';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
