-- @migration 224_supplier_order_identity.sql
-- @domain    catalog
-- @purpose   Supplier Order Identity universelle : séparer l'identité stable
--            d'une unité commandable fournisseur de son état mouvant
--            (stock/prix/fret). Le payload reste opaque pour le coeur Komerce
--            et n'est interprété que par l'adaptateur fournisseur.
--
-- Idempotent. Les lignes historiques restent NULL : aucune identité fournisseur
-- n'est inventée après coup. Elles deviennent Fulfillment Ready seulement après
-- refresh/re-promotion depuis une source capable de fournir l'identité exacte.

ALTER TABLE public.product_skus
  ADD COLUMN IF NOT EXISTS supplier_unit_ref text;

ALTER TABLE public.product_skus
  ADD COLUMN IF NOT EXISTS supplier_order_identity jsonb;

COMMENT ON COLUMN public.product_skus.supplier_unit_ref IS
  'Référence technique stable de l''unité commandable chez le fournisseur. '
  'Distincte du supplier_sku commercial/humain et des valeurs mouvantes stock/prix.';

COMMENT ON COLUMN public.product_skus.supplier_order_identity IS
  'Supplier Order Identity canonique et versionnée. Objet opaque {provider,version,payload} '
  'produit par l''adaptateur fournisseur et consommé uniquement par son preflight/order adapter. '
  'Ne contient jamais stock, prix ou fret.';

ALTER TABLE public.product_skus
  DROP CONSTRAINT IF EXISTS chk_product_skus_order_identity_shape;

ALTER TABLE public.product_skus
  ADD CONSTRAINT chk_product_skus_order_identity_shape CHECK (
    supplier_order_identity IS NULL
    OR (
      source = 'SUPPLIER'
      AND supplier_unit_ref IS NOT NULL
      AND jsonb_typeof(supplier_order_identity) = 'object'
      AND jsonb_typeof(supplier_order_identity->'payload') = 'object'
      AND COALESCE(supplier_order_identity->>'provider', '') <> ''
      AND COALESCE((supplier_order_identity->>'version')::integer, 0) >= 1
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_skus_supplier_unit_ref
  ON public.product_skus (product_id, supplier_unit_ref)
  WHERE supplier_unit_ref IS NOT NULL;
