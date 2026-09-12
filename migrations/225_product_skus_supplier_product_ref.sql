-- @migration 225_product_skus_supplier_product_ref.sql
-- @domain    catalog,purchasing
-- @purpose   Rendre la Supplier Order Identity auto-suffisante pour le refresh
--            fournisseur en persistant la référence produit fournisseur.
--
-- Doctrine : docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md
--
-- Règles :
--   - supplier_product_ref est une identité stable, pas un état mutable ;
--   - aucune valeur historique n'est reconstruite depuis supplier_sku, label,
--     sourcing_candidates ou variant_combo ;
--   - NULL reste l'état honnête jusqu'à une re-promotion depuis un contrat V2
--     fournisseur qui porte explicitement supplier_product_id ;
--   - une divergence ultérieure est bloquée par la couche applicative.

ALTER TABLE public.product_skus
  ADD COLUMN IF NOT EXISTS supplier_product_ref text;

ALTER TABLE public.product_skus
  DROP CONSTRAINT IF EXISTS chk_product_skus_supplier_product_ref_nonempty;

ALTER TABLE public.product_skus
  ADD CONSTRAINT chk_product_skus_supplier_product_ref_nonempty
  CHECK (supplier_product_ref IS NULL OR btrim(supplier_product_ref) <> '');

COMMENT ON COLUMN public.product_skus.supplier_product_ref IS
  'Référence stable du produit chez le fournisseur, nécessaire pour rafraîchir '
  'exactement le produit qui porte supplier_unit_ref. NULL = mapping historique '
  'incomplet ; aucune reconstruction heuristique ni jointure sourcing implicite.';

-- Aucun backfill : la prochaine re-promotion autoritative complète la valeur.
