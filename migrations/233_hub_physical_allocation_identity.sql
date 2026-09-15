-- @migration 233_hub_physical_allocation_identity.sql
-- @domain    inventory
-- @purpose   HUB-001 — relier la présence physique au Hub à l'allocation
--            d'achat exacte sans dupliquer l'autorité Purchasing/Orders.
--
-- Doctrine :
--   UPSTREAM determines WHO/WHAT/WHERE; HUB determines HOW to handle it.
--   Hub may SPLIT / MERGE / REPACK; Hub may NEVER REASSIGN.
--
-- `inventory_items` reste la vérité physique/custody existante. On n'ajoute
-- pas de table physical_units parallèle. purchase_order_id est uniquement une
-- référence vers la vérité d'achat déjà possédée par Purchasing.

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS purchase_order_id uuid
  REFERENCES public.purchase_orders(id) ON DELETE RESTRICT;

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS identity_verified_at timestamptz;

ALTER TABLE public.inventory_items
  DROP CONSTRAINT IF EXISTS chk_inventory_items_quantity_positive;

ALTER TABLE public.inventory_items
  ADD CONSTRAINT chk_inventory_items_quantity_positive
  CHECK (quantity > 0);

CREATE INDEX IF NOT EXISTS idx_inventory_items_purchase_order_id
  ON public.inventory_items(purchase_order_id)
  WHERE purchase_order_id IS NOT NULL;

-- Une allocation physique prouvée ne peut jamais être réinterprétée vers une
-- autre commande, ligne commerciale ou Purchase Order. Les lignes historiques
-- NULL restent honnêtes : aucun backfill heuristique.
CREATE OR REPLACE FUNCTION prevent_inventory_allocation_reassignment()
RETURNS trigger AS $$
BEGIN
  IF NEW.order_item_id IS DISTINCT FROM OLD.order_item_id THEN
    RAISE EXCEPTION 'hub_inventory_order_item_immutable';
  END IF;

  IF NEW.order_id IS DISTINCT FROM OLD.order_id THEN
    RAISE EXCEPTION 'hub_inventory_order_immutable';
  END IF;

  IF OLD.purchase_order_id IS NOT NULL
     AND NEW.purchase_order_id IS DISTINCT FROM OLD.purchase_order_id THEN
    RAISE EXCEPTION 'hub_inventory_purchase_order_immutable';
  END IF;

  IF OLD.identity_verified_at IS NOT NULL
     AND NEW.identity_verified_at IS DISTINCT FROM OLD.identity_verified_at THEN
    RAISE EXCEPTION 'hub_inventory_identity_verification_immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_allocation_identity_immutable ON public.inventory_items;
CREATE TRIGGER trg_inventory_allocation_identity_immutable
  BEFORE UPDATE ON public.inventory_items
  FOR EACH ROW
  EXECUTE FUNCTION prevent_inventory_allocation_reassignment();

COMMENT ON COLUMN public.inventory_items.purchase_order_id IS
  'HUB-001 — allocation d''achat Purchasing exacte prouvée à la réception physique. NULL = historique/non prouvé, jamais deviné.';
COMMENT ON COLUMN public.inventory_items.identity_verified_at IS
  'Instant où order_item/order/purchase_order ont été revalidés ensemble. Immuable une fois posé.';
COMMENT ON FUNCTION prevent_inventory_allocation_reassignment() IS
  'HUB-001 — Hub peut changer le traitement physique, jamais réassigner l''identité commerciale ou d''achat prouvée.';
