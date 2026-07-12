-- @migration 104_product_skus.sql
-- @domain    catalog
-- @purpose   Lot 0 — Décision DECISION_MODELE_STOCK_SKU.md : "une unité vendable = un SKU"
-- @added-header 2026-07-12
-- Idempotent : peut être rejoué sans risque.
-- Portée : schéma uniquement. Aucune écriture applicative ne pointe encore
-- vers product_skus après cette migration — adjustStock(), routes/orders/create.js
-- et parcel-operations.js continuent d'utiliser le chemin existant (product_variants
-- à deux axes) tant que les Lots 1-5 ne sont pas livrés. Rien ne casse.
--
-- Ajustement 2026-07-12 (validation Tony) : pas de fallback implicite basé sur
-- l'existence de lignes dans product_skus. Le mode de stock d'un produit est
-- porté explicitement par products.inventory_model. Tant qu'un produit est
-- LEGACY_VARIANTS, aucun code ne doit lire/écrire product_skus pour lui. La
-- bascule vers SKU est un acte explicite et atomique (Lot 5), jamais déduit.

-- ─────────────────────────────────────────────────────────────────────
--  1. TABLE product_skus — future source de vérité unique du stock
--     pour les produits à variantes (et, à terme, tous les produits).
--
--     variant_combo = NULL  → SKU par défaut d'un produit sans variantes
--     variant_combo = jsonb → une combinaison précise, ex: {"couleur":"Noir","taille":"M"}
--                             même shape que order_items.variant_combo (Lot 3).
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.product_skus (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sku            text,
  variant_combo  jsonb,
  stock          integer NOT NULL DEFAULT 0,
  price_kmf      integer,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamp with time zone NOT NULL DEFAULT now(),
  updated_at     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT product_skus_stock_non_negatif CHECK (stock >= 0),
  CONSTRAINT product_skus_prix_non_negatif  CHECK (price_kmf IS NULL OR price_kmf >= 0)
);

COMMENT ON TABLE public.product_skus IS
  'Source de vérité du stock par unité vendable (Lot 0, DECISION_MODELE_STOCK_SKU.md). '
  'variant_combo NULL = SKU par défaut (produit sans variantes). '
  'Non consommée par le code applicatif tant que les Lots 1-4 ne sont pas livrés.';

COMMENT ON COLUMN public.product_skus.variant_combo IS
  'Même shape que order_items.variant_combo, ex: {"couleur":"Noir","taille":"M"}. NULL = SKU par défaut.';

-- ─────────────────────────────────────────────────────────────────────
--  2. UNICITÉ — au plus une ligne par combinaison, au plus un SKU
--     par défaut par produit.
-- ─────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_skus_combo
  ON public.product_skus (product_id, variant_combo)
  WHERE variant_combo IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_skus_default
  ON public.product_skus (product_id)
  WHERE variant_combo IS NULL;

CREATE INDEX IF NOT EXISTS idx_product_skus_product
  ON public.product_skus (product_id);

-- ─────────────────────────────────────────────────────────────────────
--  3. updated_at automatique — réutilise la fonction déjà en place
--     pour product_variants (patch_variants.sql).
-- ─────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_product_skus_updated ON public.product_skus;

CREATE TRIGGER trg_product_skus_updated
  BEFORE UPDATE ON public.product_skus
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
--  4. order_items.sku_id — nullable, non consommée avant Lot 3.
--     ON DELETE SET NULL : un SKU supprimé ne doit jamais faire
--     échouer/perdre une ligne de commande historique.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS sku_id uuid REFERENCES public.product_skus(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_items_sku_id
  ON public.order_items (sku_id)
  WHERE sku_id IS NOT NULL;

COMMENT ON COLUMN public.order_items.sku_id IS
  'FK vers product_skus (Lot 0). NULL tant que routes/orders/create.js ne le renseigne pas (Lot 3). '
  'Remplacera variant_combo comme canal de pilotage du stock — variant_combo reste pour affichage/historique.';

-- ─────────────────────────────────────────────────────────────────────
--  5. products.inventory_model — bascule explicite, jamais déduite.
--     Défaut LEGACY_VARIANTS pour tous les produits existants et futurs :
--     un produit ne passe en SKU que par un acte volontaire (Lot 5), après
--     que ses SKU aient été préparés et audités READY (Lot 1).
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS inventory_model text NOT NULL DEFAULT 'LEGACY_VARIANTS';

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS chk_products_inventory_model;

ALTER TABLE public.products
  ADD CONSTRAINT chk_products_inventory_model
  CHECK (inventory_model IN ('LEGACY_VARIANTS', 'SKU'));

CREATE INDEX IF NOT EXISTS idx_products_inventory_model
  ON public.products (inventory_model)
  WHERE inventory_model = 'SKU';

COMMENT ON COLUMN public.products.inventory_model IS
  'LEGACY_VARIANTS (défaut) = stock lu/écrit sur products.stock + product_variants.stock. '
  'SKU = stock lu/écrit exclusivement sur product_skus, aucune lecture/écriture legacy '
  'autorisée pour ce produit. Bascule atomique portée par le Lot 5 — jamais déduite de '
  'l''existence de lignes product_skus.';

-- ─────────────────────────────────────────────────────────────────────
-- Vérification post-migration (à lancer manuellement, lecture seule) :
--
--   SELECT count(*) FROM product_skus;                            -- attendu : 0
--   SELECT count(*) FROM order_items WHERE sku_id IS NOT NULL;     -- attendu : 0
--   SELECT inventory_model, count(*) FROM products GROUP BY 1;     -- attendu : 100% LEGACY_VARIANTS
--   \d product_skus
--   \d order_items   -- vérifier la présence de sku_id
--   \d products       -- vérifier la présence de inventory_model
-- ─────────────────────────────────────────────────────────────────────
