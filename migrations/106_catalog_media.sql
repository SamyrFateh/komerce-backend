-- @migration 106_catalog_media.sql
-- @domain    catalog
-- @purpose   PDC-8 Lot 2 — modèle média canonique, cible de promotion pour
--            NormalizedSupplierProduct V2 (media[]).
-- @added-header 2026-07-13
-- Idempotent : peut être rejoué sans risque.
--
-- Portée : schéma uniquement. Aucune écriture applicative ne pointe encore
-- vers catalog_media après cette migration — le service de promotion
-- (Lot 6) est le seul futur écrivain. products.image_url / products.images /
-- product_variants.image_url / product_variants.images restent le chemin
-- legacy pour les produits non promus (PDC-8 §MODÈLE MÉDIA CANONIQUE).
--
-- IDENTITÉ STABLE (audit préalable, cf. PDC-8 §MODÈLE MÉDIA CANONIQUE) :
--   product_id + source_media_id.
--   Un média V2 avec supplier_media_id = IMG-RED-01 doit, à chaque
--   re-promotion, mettre à jour LA MÊME ligne canonique — jamais en créer
--   une nouvelle parce que l'URL, le rôle, l'alt ou l'ordre a changé.
--   Aucune contrainte d'unicité n'existait avant cette migration sur
--   products.images / product_variants.images (JSONB en tableau, sans
--   identité par élément) : rien à migrer, la table est neuve.
--
-- Pour un média SANS source_media_id (source pauvre, ne connaît pas d'id
-- stable), aucune identité fournisseur n'est fabriquée : pas de contrainte
-- d'unicité applicable pour ces lignes (index partiel WHERE source_media_id
-- IS NOT NULL). La ré-promotion d'un média sans identité peut donc dupliquer
-- une ligne — comportement honnête documenté, pas un bug à corriger ici.

CREATE TABLE IF NOT EXISTS public.catalog_media (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  source_media_id text,          -- supplier_media_id V2, NULL si source pauvre
  url            text NOT NULL,
  role           varchar(20) NOT NULL DEFAULT 'PRODUCT',
  alt            text,
  option_values  jsonb,          -- ex: {"couleur":"Rouge"} — multi-axes, tel que fourni par la source
  display_order  integer,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_media_role_check
    CHECK (role IN ('PRODUCT', 'SCENE', 'DETAIL', 'SIZE_GUIDE', 'OTHER')),
  CONSTRAINT catalog_media_option_values_object
    CHECK (option_values IS NULL OR jsonb_typeof(option_values) = 'object')
);

COMMENT ON TABLE public.catalog_media IS
  'Média canonique catalogue (PDC-8 Lot 2). Cible de promotion depuis '
  'normalized_source_contract.media[]. Identité stable : product_id + '
  'source_media_id lorsque connu. Legacy (products.images / '
  'product_variants.images) reste le fallback pour les produits non promus.';

COMMENT ON COLUMN public.catalog_media.source_media_id IS
  'supplier_media_id V2 tel quel. NULL = source pauvre, aucune identité '
  'fournisseur fabriquée : pas d''unicité applicable, ré-promotion peut '
  'dupliquer honnêtement.';

-- ─────────────────────────────────────────────────────────────────────
--  Identité stable — au plus une ligne par (product_id, source_media_id)
--  connu. Permet l'upsert idempotent lors d'une re-promotion.
-- ─────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS ux_catalog_media_source_identity
  ON public.catalog_media (product_id, source_media_id)
  WHERE source_media_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_catalog_media_product
  ON public.catalog_media (product_id, display_order);

-- ─────────────────────────────────────────────────────────────────────
--  updated_at automatique — réutilise la fonction déjà en place pour
--  product_variants / product_skus (patch_variants.sql / 104).
-- ─────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_catalog_media_updated ON public.catalog_media;

CREATE TRIGGER trg_catalog_media_updated
  BEFORE UPDATE ON public.catalog_media
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- Vérification post-migration (à lancer manuellement, lecture seule) :
--
--   SELECT count(*) FROM catalog_media;                 -- attendu : 0
--   \d catalog_media
-- ─────────────────────────────────────────────────────────────────────
