-- @migration patch_variants_images.sql
-- @domain    catalog
-- @purpose   Lot 2 — Ajouter images[] aux variantes couleur
-- @added-header 2026-07-07 (roadmap modal mobile enrichie)
-- Idempotent : peut être rejoué sans risque

BEGIN;

-- 1. Ajout colonne images JSONB (tableau d'URLs)
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]';

-- 2. Backfill : copier image_url existant dans images[0]
UPDATE public.product_variants
  SET images = jsonb_build_array(image_url)
  WHERE image_url IS NOT NULL
    AND image_url != ''
    AND images = '[]';

-- 3. Mettre à jour la vue ordonnée
-- IMPORTANT : "images" doit rester en DERNIÈRE position. CREATE OR REPLACE VIEW
-- interdit de renommer/décaler les colonnes existantes (ordinal position figée) ;
-- on ne peut qu'ajouter des colonnes à la fin. Insérer "images" avant "display_order"
-- fait échouer le CREATE OR REPLACE VIEW ("cannot change name of view column
-- display_order to images") — cf. incident prod du 2026-07-10.
CREATE OR REPLACE VIEW public.product_variants_ordered AS
SELECT
  id,
  product_id,
  variant_type,
  variant_value,
  sku,
  COALESCE(stock, 0) AS stock,
  price_kmf,
  image_url,
  display_order,
  created_at,
  updated_at,
  images
FROM public.product_variants
ORDER BY product_id, variant_type, display_order ASC, created_at ASC;

COMMENT ON VIEW public.product_variants_ordered IS
  'Variantes triées display_order ASC — inclut images[] (Lot 2)';

COMMIT;