-- @migration 162_order_items_fulfillment_source.sql
-- @domain    orders
-- @purpose   Fulfillment mixte Lot C — figer sur chaque nouvelle ligne de
--            commande la provenance décidée sous transaction par le resolver
--            local-stock : LOCAL_STOCK ou IMPORT.
-- @added-header 2026-09-04
-- Idempotent : peut être rejoué sans risque.
--
-- IMPORTANT — historique : les lignes créées avant cette migration ne sont
-- PAS backfillées. `local_stock_allocations` ne porte pas order_item_id ; la
-- provenance historique d'une ligne ne peut donc pas être reconstruite sans
-- ambiguïté. NULL signifie uniquement « snapshot non disponible / ligne
-- historique ou synthétique », jamais « IMPORT par défaut ».

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS fulfillment_source text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'order_items_fulfillment_source_valid'
  ) THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_fulfillment_source_valid
      CHECK (
        fulfillment_source IS NULL
        OR fulfillment_source IN ('LOCAL_STOCK', 'IMPORT')
      );
  END IF;
END $$;

COMMENT ON COLUMN public.order_items.fulfillment_source IS
  'Snapshot immuable de provenance au checkout : LOCAL_STOCK ou IMPORT. '
  'NULL est réservé aux lignes historiques/synthétiques sans snapshot fiable '
  'et ne doit jamais être interprété comme IMPORT.';

-- Le snapshot est fixé à l'INSERT par orders. Toute tentative de changer la
-- provenance d'une ligne après création est un bug : disponibilité_status et
-- parcels peuvent évoluer, fulfillment_source non.
CREATE OR REPLACE FUNCTION prevent_order_item_fulfillment_source_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.fulfillment_source IS DISTINCT FROM NEW.fulfillment_source THEN
    RAISE EXCEPTION
      'order_items.fulfillment_source est immuable après création (% -> %)',
      OLD.fulfillment_source, NEW.fulfillment_source
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_items_fulfillment_source_immutable
  ON public.order_items;

CREATE TRIGGER trg_order_items_fulfillment_source_immutable
  BEFORE UPDATE OF fulfillment_source ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION prevent_order_item_fulfillment_source_change();
