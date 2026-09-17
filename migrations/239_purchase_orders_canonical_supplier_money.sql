-- @migration 239_purchase_orders_canonical_supplier_money.sql
-- @domain    purchasing
-- @purpose   Décorréler la monnaie fournisseur de l'ancien modèle AED-only.
--
-- Doctrine :
--   - une Purchase Order snapshotte le prix fournisseur dans sa monnaie native ;
--   - unit_price_aed reste un champ legacy de compatibilité, jamais une autorité
--     pour une unité canonique non-AED ;
--   - product_suppliers choisit le fournisseur opérationnel ; son ancien prix
--     AED devient optionnel pour les produits passés sur Product SKU + SOI.

ALTER TABLE public.product_suppliers
  ALTER COLUMN supplier_price_aed DROP NOT NULL;

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS supplier_unit_price numeric(18,4);

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS supplier_currency text;

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS supplier_total_price numeric(18,4)
  GENERATED ALWAYS AS (supplier_unit_price * qty::numeric) STORED;

-- Les PO historiques AED sont migrées sans changer leur valeur économique.
UPDATE public.purchase_orders
   SET supplier_unit_price = unit_price_aed,
       supplier_currency = 'AED'
 WHERE supplier_unit_price IS NULL
   AND supplier_currency IS NULL
   AND unit_price_aed IS NOT NULL;

ALTER TABLE public.purchase_orders
  DROP CONSTRAINT IF EXISTS chk_purchase_orders_supplier_money_pair;

ALTER TABLE public.purchase_orders
  ADD CONSTRAINT chk_purchase_orders_supplier_money_pair
  CHECK (
    (supplier_unit_price IS NULL AND supplier_currency IS NULL)
    OR (
      supplier_unit_price > 0
      AND supplier_currency ~ '^[A-Z]{3}$'
    )
  );

COMMENT ON COLUMN public.product_suppliers.supplier_price_aed IS
  'LEGACY uniquement. Prix AED historique du mapping. NULL autorisé pour les produits SKU/SOI dont le prix fournisseur vient de la Canonical Unit.';

COMMENT ON COLUMN public.purchase_orders.supplier_unit_price IS
  'Prix unitaire fournisseur snapshoté dans la monnaie native au moment de créer la PO.';

COMMENT ON COLUMN public.purchase_orders.supplier_currency IS
  'Code devise ISO 4217 à 3 lettres correspondant à supplier_unit_price.';

COMMENT ON COLUMN public.purchase_orders.supplier_total_price IS
  'Total fournisseur natif = supplier_unit_price × qty. Généré, sans conversion implicite.';
