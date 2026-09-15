-- @migration 233_hub_physical_allocation_identity.sql
-- @domain    inventory
-- @purpose   HUB-001 — relier la présence physique au Hub à l'allocation
--            d'achat exacte sans dupliquer l'autorité Purchasing/Orders et
--            empêcher toute réassignation cross-Market/cross-destination.
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

-- Un split physique crée une NOUVELLE allocation physique de même identité,
-- reliée à la ligne mère. Ce lien est de la traçabilité physique, pas une
-- nouvelle autorité commerciale.
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS split_from_inventory_item_id uuid
  REFERENCES public.inventory_items(id) ON DELETE RESTRICT;

ALTER TABLE public.inventory_items
  DROP CONSTRAINT IF EXISTS chk_inventory_items_quantity_positive;

ALTER TABLE public.inventory_items
  ADD CONSTRAINT chk_inventory_items_quantity_positive
  CHECK (quantity > 0);

CREATE INDEX IF NOT EXISTS idx_inventory_items_purchase_order_id
  ON public.inventory_items(purchase_order_id)
  WHERE purchase_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_items_split_from
  ON public.inventory_items(split_from_inventory_item_id)
  WHERE split_from_inventory_item_id IS NOT NULL;

-- Une ligne par (Market Parcel, order_item). Toute partition physique dans un
-- même colis est agrégée par quantity ; cela évite les doublons de packing et
-- rend split/merge déterministes.
CREATE UNIQUE INDEX IF NOT EXISTS ux_parcel_items_parcel_order_item
  ON public.parcel_items(parcel_id, order_item_id)
  WHERE order_item_id IS NOT NULL;

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

  IF OLD.split_from_inventory_item_id IS NOT NULL
     AND NEW.split_from_inventory_item_id IS DISTINCT FROM OLD.split_from_inventory_item_id THEN
    RAISE EXCEPTION 'hub_inventory_split_lineage_immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_allocation_identity_immutable ON public.inventory_items;
CREATE TRIGGER trg_inventory_allocation_identity_immutable
  BEFORE UPDATE ON public.inventory_items
  FOR EACH ROW
  EXECUTE FUNCTION prevent_inventory_allocation_reassignment();

-- Vérifie la compatibilité commerciale d'un couple order_item / parcel.
-- Même relais => même destination canonique ; F1 garantit que ce relais porte
-- le même Market que l'order. On vérifie néanmoins les deux valeurs ici pour
-- que la frontière Hub reste autoportante et fail-closed.
CREATE OR REPLACE FUNCTION assert_hub_parcel_membership_compatible(
  p_order_item_id uuid,
  p_parcel_id uuid
) RETURNS void AS $$
DECLARE
  order_market_id uuid;
  order_relais_id uuid;
  parcel_market_id uuid;
  parcel_relais_id uuid;
BEGIN
  SELECT o.market_id, o.relais_id
    INTO order_market_id, order_relais_id
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
   WHERE oi.id = p_order_item_id;

  IF order_market_id IS NULL OR order_relais_id IS NULL THEN
    RAISE EXCEPTION 'hub_order_destination_unproven';
  END IF;

  SELECT r.market_id, p.relais_id
    INTO parcel_market_id, parcel_relais_id
    FROM public.parcels p
    LEFT JOIN public.relais r ON r.id = p.relais_id
   WHERE p.id = p_parcel_id;

  IF parcel_market_id IS NULL OR parcel_relais_id IS NULL THEN
    RAISE EXCEPTION 'hub_parcel_destination_unproven';
  END IF;

  IF parcel_relais_id IS DISTINCT FROM order_relais_id THEN
    RAISE EXCEPTION 'hub_destination_reassignment_forbidden';
  END IF;

  IF parcel_market_id IS DISTINCT FROM order_market_id THEN
    RAISE EXCEPTION 'hub_market_reassignment_forbidden';
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- Filet DB global : aucun writer de parcel_items (Inventory, Logistics,
-- admin, legacy) ne peut introduire un mélange cross-Market/cross-Relais.
CREATE OR REPLACE FUNCTION prevent_parcel_item_destination_mismatch()
RETURNS trigger AS $$
BEGIN
  PERFORM assert_hub_parcel_membership_compatible(NEW.order_item_id, NEW.parcel_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_parcel_item_destination_compatibility ON public.parcel_items;
CREATE TRIGGER trg_parcel_item_destination_compatibility
  BEFORE INSERT OR UPDATE OF parcel_id, order_item_id ON public.parcel_items
  FOR EACH ROW
  EXECUTE FUNCTION prevent_parcel_item_destination_mismatch();

-- Même filet sur l'état physique : poser/changer inventory_items.parcel_id
-- exige la même destination que l'order_item. Les changements purement
-- physiques dans un même Market/Relais restent possibles ; la destination
-- commerciale ne l'est jamais.
CREATE OR REPLACE FUNCTION prevent_inventory_parcel_destination_mismatch()
RETURNS trigger AS $$
BEGIN
  IF NEW.parcel_id IS NOT NULL
     AND NEW.parcel_id IS DISTINCT FROM OLD.parcel_id THEN
    PERFORM assert_hub_parcel_membership_compatible(NEW.order_item_id, NEW.parcel_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_parcel_destination_compatibility ON public.inventory_items;
CREATE TRIGGER trg_inventory_parcel_destination_compatibility
  BEFORE UPDATE OF parcel_id ON public.inventory_items
  FOR EACH ROW
  EXECUTE FUNCTION prevent_inventory_parcel_destination_mismatch();

COMMENT ON COLUMN public.inventory_items.purchase_order_id IS
  'HUB-001 — allocation d''achat Purchasing exacte prouvée à la réception physique. NULL = historique/non prouvé, jamais deviné.';
COMMENT ON COLUMN public.inventory_items.identity_verified_at IS
  'Instant où order_item/order/purchase_order ont été revalidés ensemble. Immuable une fois posé.';
COMMENT ON COLUMN public.inventory_items.split_from_inventory_item_id IS
  'HUB-001 — lineage d''un split physique explicite. La ligne enfant conserve exactement la même identité commerciale et d''achat.';
COMMENT ON FUNCTION prevent_inventory_allocation_reassignment() IS
  'HUB-001 — Hub peut changer le traitement physique, jamais réassigner l''identité commerciale ou d''achat prouvée.';
COMMENT ON FUNCTION assert_hub_parcel_membership_compatible(uuid, uuid) IS
  'HUB-001 — preuve DB que l''order_item et le Market Parcel partagent exactement le même Relais et le même Market.';
