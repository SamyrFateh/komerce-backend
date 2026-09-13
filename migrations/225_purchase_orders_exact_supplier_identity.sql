-- @migration 225_purchase_orders_exact_supplier_identity.sql
-- @domain    purchasing
-- @purpose   Relier chaque nouvelle Purchase Order à la ligne/SKU vendu et
--            snapshotter l'identité fournisseur exacte utilisée pour l'achat.
--
-- Doctrine :
--   - docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md
--   - docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md
--
-- Règles :
--   - aucune reconstruction heuristique des PO historiques ;
--   - une ligne de commande SKU conserve product_sku_id + Supplier Order Identity ;
--   - product_suppliers choisit le fournisseur mais ne remplace jamais l'identité
--     de l'unité vendue ;
--   - order_item_id devient l'autorité d'idempotence pour les nouvelles PO.

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS order_item_id uuid
  REFERENCES public.order_items(id) ON DELETE SET NULL;

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS product_sku_id uuid
  REFERENCES public.product_skus(id) ON DELETE SET NULL;

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS supplier_unit_ref text;

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS supplier_order_identity jsonb;

ALTER TABLE public.purchase_orders
  DROP CONSTRAINT IF EXISTS chk_purchase_orders_supplier_unit_ref_nonempty;

ALTER TABLE public.purchase_orders
  ADD CONSTRAINT chk_purchase_orders_supplier_unit_ref_nonempty
  CHECK (supplier_unit_ref IS NULL OR btrim(supplier_unit_ref) <> '');

ALTER TABLE public.purchase_orders
  DROP CONSTRAINT IF EXISTS chk_purchase_orders_supplier_order_identity_shape;

ALTER TABLE public.purchase_orders
  ADD CONSTRAINT chk_purchase_orders_supplier_order_identity_shape
  CHECK (
    supplier_order_identity IS NULL
    OR (
      product_sku_id IS NOT NULL
      AND supplier_unit_ref IS NOT NULL
      AND jsonb_typeof(supplier_order_identity) = 'object'
      AND jsonb_typeof(supplier_order_identity->'provider') = 'string'
      AND btrim(supplier_order_identity->>'provider') <> ''
      AND jsonb_typeof(supplier_order_identity->'version') = 'number'
      AND (supplier_order_identity->>'version') ~ '^[0-9]+$'
      AND (supplier_order_identity->>'version')::integer >= 1
      AND jsonb_typeof(supplier_order_identity->'payload') = 'object'
      AND supplier_order_identity->'payload' <> '{}'::jsonb
    )
  );

CREATE INDEX IF NOT EXISTS idx_purchase_orders_order_item_id
  ON public.purchase_orders(order_item_id)
  WHERE order_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_product_sku_id
  ON public.purchase_orders(product_sku_id)
  WHERE product_sku_id IS NOT NULL;

-- Une ligne de commande ne doit pas créer deux PO actives vers le même mapping
-- fournisseur lors d'un rejeu. Les lignes historiques restent hors index car
-- order_item_id est volontairement NULL (aucun backfill heuristique).
CREATE UNIQUE INDEX IF NOT EXISTS ux_purchase_orders_order_item_supplier_active
  ON public.purchase_orders(order_item_id, product_supplier_id)
  WHERE order_item_id IS NOT NULL
    AND product_supplier_id IS NOT NULL
    AND status <> 'cancelled';

COMMENT ON COLUMN public.purchase_orders.order_item_id IS
  'Ligne de commande cliente ayant déclenché cette PO. NULL uniquement pour les PO historiques/manuelles antérieures au snapshot exact.';

COMMENT ON COLUMN public.purchase_orders.product_sku_id IS
  'SKU Komerce exact vendu lorsque la ligne est en mode SKU. Snapshot de traçabilité vers product_skus ; aucune résolution par libellé.';

COMMENT ON COLUMN public.purchase_orders.supplier_unit_ref IS
  'Référence stable de l''unité fournisseur commandable snapshotée au moment de créer la PO.';

COMMENT ON COLUMN public.purchase_orders.supplier_order_identity IS
  'Supplier Order Identity canonique {provider,version,payload} snapshotée depuis product_skus. Ne contient ni prix, ni stock, ni fret.';

-- Pas de backfill : les anciennes PO restent honnêtement sans identité SKU exacte.
