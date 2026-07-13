-- @migration 109_product_sku_media.sql
-- @domain    catalog
-- @purpose   PDC-8 Lot 5 — couture explicite product_skus <-> catalog_media,
--            portée par sellable_units[].media_refs (V2), jamais reconstruite
--            par heuristique option_values quand ces références existent.
-- @added-header 2026-07-13
-- Idempotent : peut être rejoué sans risque.
--
-- Portée : schéma uniquement. Aucune écriture applicative ne pointe encore
-- vers cette table après cette migration — le service de promotion (Lot 6)
-- est le seul futur écrivain, le Product Detail Contract (Lot 7) le seul
-- futur lecteur. Le matching legacy option_values (catalog-product-detail.js
-- buildSellableUnits/mediaMatchesOptions) reste le fallback pour les
-- produits sans association explicite ici — non touché par ce lot.

CREATE TABLE IF NOT EXISTS public.product_sku_media (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id         uuid NOT NULL REFERENCES public.product_skus(id) ON DELETE CASCADE,
  media_id       uuid NOT NULL REFERENCES public.catalog_media(id) ON DELETE CASCADE,
  display_order  integer,        -- ordre éventuel SI réellement porté par la source (V2 ne le fournit pas à ce niveau aujourd'hui — NULL, jamais fabriqué)
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.product_sku_media IS
  'Association explicite SKU <-> média canonique (PDC-8 Lot 5), source : '
  'sellable_units[].media_refs (V2). Les références explicites gagnent '
  'toujours sur un matching option_values heuristique. Table neuve, '
  'aucun writer avant le service de promotion (Lot 6).';

-- ─────────────────────────────────────────────────────────────────────
--  Idempotence — une même association (sku_id, media_id) ne doit jamais
--  être dupliquée lors d'une re-promotion.
-- ─────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_sku_media_pair
  ON public.product_sku_media (sku_id, media_id);

CREATE INDEX IF NOT EXISTS idx_product_sku_media_sku
  ON public.product_sku_media (sku_id);

CREATE INDEX IF NOT EXISTS idx_product_sku_media_media
  ON public.product_sku_media (media_id);

-- ─────────────────────────────────────────────────────────────────────
-- Vérification post-migration (à lancer manuellement, lecture seule) :
--
--   SELECT count(*) FROM product_sku_media;  -- attendu : 0
--   \d product_sku_media
-- ─────────────────────────────────────────────────────────────────────
