-- @migration 107_product_variants_axis_display_name.sql
-- @domain    catalog
-- @purpose   PDC-8 Lot 3 — préserver option_axes[].display_name (V2) lorsque
--            la source le porte, sans fabriquer de nouvelle table d'axes.
-- @added-header 2026-07-13
-- Idempotent : peut être rejoué sans risque.
--
-- Décision (PDC-8 §OPTION AXES) : product_variants reste le modèle descriptif
-- des axes (une ligne par couple type/valeur), le produit cartésien n'est
-- jamais persisté. display_name n'a de sens qu'au niveau de l'AXE (la clé),
-- pas de la valeur — il est donc dupliqué sur chaque ligne partageant le même
-- variant_type pour ce produit, cohérent avec le style dénormalisé déjà en
-- place (pas de table axes séparée). NULL = source ne portait pas de
-- display_name pour cet axe ; ne jamais fabriquer une valeur de repli ici,
-- la couche d'affichage retombe sur variant_type brut si besoin.

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS display_name text;

COMMENT ON COLUMN public.product_variants.display_name IS
  'Nom d''affichage de l''AXE (ex: "Couleur" pour variant_type="couleur"), '
  'préservé tel que fourni par NormalizedSupplierProduct V2 option_axes[].display_name '
  '(PDC-8 Lot 3). NULL = source ne le portait pas — jamais fabriqué.';

-- ─────────────────────────────────────────────────────────────────────
-- Vérification post-migration (à lancer manuellement, lecture seule) :
--
--   SELECT count(*) FROM product_variants WHERE display_name IS NOT NULL; -- attendu : 0
--   \d product_variants
-- ─────────────────────────────────────────────────────────────────────
