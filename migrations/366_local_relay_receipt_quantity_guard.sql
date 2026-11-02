-- @migration 366_local_relay_receipt_quantity_guard.sql
-- @domain logistics, orders, local-stock
-- A physical LOCAL_STOCK receipt occurs at the destination relay, without
-- any international shipment. Do NOT forge qty_shipped to appease the
-- import-only parcel quantity trigger (migration 022).
-- Fail closed for IMPORT/NULL or missing relay receipt proof.
CREATE OR REPLACE FUNCTION public.check_parcel_item_quantities()
RETURNS TRIGGER AS $$
DECLARE
  local_receipt_proven BOOLEAN := FALSE;
BEGIN
  IF NEW.qty_packed > NEW.qty_allocated THEN
    RAISE EXCEPTION 'ANTI-ERREUR: qty_packed (%) > qty_allocated (%) pour parcel_item %',
      NEW.qty_packed, NEW.qty_allocated, NEW.id;
  END IF;
  IF NEW.qty_shipped > NEW.qty_packed THEN
    RAISE EXCEPTION 'ANTI-ERREUR: qty_shipped (%) > qty_packed (%) pour parcel_item %',
      NEW.qty_shipped, NEW.qty_packed, NEW.id;
  END IF;
  IF NEW.qty_received > NEW.qty_shipped THEN
    SELECT EXISTS (
      SELECT 1
        FROM public.order_items oi
        JOIN public.parcels p ON p.id = NEW.parcel_id
        JOIN public.scans s ON s.parcel_id = p.id
       WHERE oi.id = NEW.order_item_id
         AND oi.order_id = p.order_id
         AND oi.fulfillment_source = 'LOCAL_STOCK'
         AND s.order_id = oi.order_id
         AND s.step = 'relais_received'
         AND s.scanned_by IS NOT NULL
    ) INTO local_receipt_proven;
    IF NOT local_receipt_proven THEN
      RAISE EXCEPTION 'ANTI-ERREUR: qty_received (%) > qty_shipped (%) sans réception locale attestée pour parcel_item %',
        NEW.qty_received, NEW.qty_shipped, NEW.id;
    END IF;
  END IF;
  IF NEW.qty_collected > NEW.qty_received THEN
    RAISE EXCEPTION 'ANTI-ERREUR: qty_collected (%) > qty_received (%) pour parcel_item %',
      NEW.qty_collected, NEW.qty_received, NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Preserve trg_check_parcel_item_qty (BEFORE INSERT OR UPDATE) from migration 022.
