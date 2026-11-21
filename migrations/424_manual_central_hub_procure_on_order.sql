-- Migration 424: immutable sale-to-procure snapshot for manually sourced Central Hub SKU.
-- Historical order lines default false; no automatic inventory movement or backfill.
ALTER TABLE public.order_items
 ADD COLUMN IF NOT EXISTS procure_on_order boolean NOT NULL DEFAULT FALSE;

DO $$ BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_constraint WHERE conname='chk_order_items_procure_on_order_import'
    AND conrelid='public.order_items'::regclass
 ) THEN
  ALTER TABLE public.order_items ADD CONSTRAINT chk_order_items_procure_on_order_import
    CHECK (NOT procure_on_order OR (sku_id IS NOT NULL AND fulfillment_source='IMPORT'));
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.guard_order_item_procure_on_order()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.procure_on_order IS DISTINCT FROM OLD.procure_on_order THEN
   RAISE EXCEPTION 'procure_on_order is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.procure_on_order THEN
  IF NOT EXISTS(
   SELECT 1 FROM public.products p
    JOIN public.product_skus k ON k.product_id=p.id
    JOIN public.suppliers hub ON hub.id=p.procurement_supplier_id
    JOIN public.sourcing_candidates sc
      ON sc.product_id=p.id AND sc.supplier_id=hub.id
   WHERE p.id=NEW.product_id AND k.id=NEW.sku_id AND p.inventory_model='SKU'
     AND k.is_active=TRUE AND k.stock=0 AND k.source='MANUAL'
     AND k.supplier_order_identity IS NULL AND hub.system_key='central_hub'
     AND hub.is_active=TRUE AND hub.deleted_at IS NULL
     AND sc.state='imported_to_catalog'
     AND sc.normalized_source_contract->>'source_kind'='central_hub_manual'
  ) THEN
   RAISE EXCEPTION 'procure_on_order requires verified Central Hub zero-stock SKU'
     USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_order_item_procure_on_order ON public.order_items;
CREATE TRIGGER trg_order_item_procure_on_order
BEFORE INSERT OR UPDATE ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.guard_order_item_procure_on_order();

COMMENT ON COLUMN public.order_items.procure_on_order IS
 'Immutable purchase-on-order snapshot: verified manual Central Hub import; no stock debit or restore on payment, cancellation, or backorder.';
