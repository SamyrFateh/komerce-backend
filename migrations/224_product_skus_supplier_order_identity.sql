-- @migration 224_product_skus_supplier_order_identity.sql
-- @domain    catalog,purchasing
-- @purpose   Persister l'identité fournisseur commandable canonique directement
--            sur product_skus, sans backfill heuristique des lignes historiques.
--
-- Doctrine : docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md
--
-- Règles :
--   - supplier_sku reste l'identité de réconciliation catalogue ;
--   - supplier_unit_ref + supplier_order_identity décrivent l'unité réellement
--     commandable ;
--   - les lignes historiques restent NULL tant qu'un refresh fournisseur n'a
--     pas fourni une identité native ;
--   - aucune identité existante n'est reconstruite ou remplacée ici.

ALTER TABLE public.product_skus
  ADD COLUMN IF NOT EXISTS supplier_unit_ref text;

ALTER TABLE public.product_skus
  ADD COLUMN IF NOT EXISTS supplier_order_identity jsonb;

ALTER TABLE public.product_skus
  DROP CONSTRAINT IF EXISTS chk_product_skus_supplier_unit_ref_nonempty;

ALTER TABLE public.product_skus
  ADD CONSTRAINT chk_product_skus_supplier_unit_ref_nonempty
  CHECK (supplier_unit_ref IS NULL OR btrim(supplier_unit_ref) <> '');

ALTER TABLE public.product_skus
  DROP CONSTRAINT IF EXISTS chk_product_skus_supplier_order_identity_shape;

ALTER TABLE public.product_skus
  ADD CONSTRAINT chk_product_skus_supplier_order_identity_shape
  CHECK (
    supplier_order_identity IS NULL
    OR (
      supplier_unit_ref IS NOT NULL
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

COMMENT ON COLUMN public.product_skus.supplier_unit_ref IS
  'Référence technique stable de l''unité commandable fournisseur. NULL pour '
  'les SKU historiques/manuels non encore résolus. Ne jamais reconstruire par '
  'heuristique depuis variant_combo ou un libellé humain.';

COMMENT ON COLUMN public.product_skus.supplier_order_identity IS
  'Supplier Order Identity canonique et versionnée {provider,version,payload}. '
  'Le payload est opaque au coeur Komerce et ne contient ni prix, ni stock, ni '
  'fret. NULL signifie non Supplier-Mapped / non Fulfillment Ready.';

-- Une même unité fournisseur ne doit pas être projetée vers deux SKU du même
-- produit. Le scope product_id est intentionnel : supplier_unit_ref est une
-- identité d'unité dans le contexte du produit fournisseur associé.
CREATE UNIQUE INDEX IF NOT EXISTS ux_product_skus_supplier_unit_ref
  ON public.product_skus (product_id, supplier_unit_ref)
  WHERE supplier_unit_ref IS NOT NULL;

-- Pas de backfill : NULL est l'état honnête pour les lignes historiques.
