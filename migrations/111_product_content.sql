-- @migration 111_product_content.sql
-- @domain    catalog
-- @purpose   Lot Content — fiche produit enrichie : profil éditorial 1:1, sections
--            (guide des tailles, matières, entretien, avertissements...) et attributs
--            structurés (points forts, spécifications), promus idempotemment depuis
--            normalized_source_contract V2 par services/catalog-promotion.js.
-- @added-header 2026-07
-- Idempotent : peut être rejoué sans risque.
--
-- DOCTRINE OVERRIDE MANUEL (docs/doctrine/DOCTRINE_CATALOGUE.md §5, "le pipeline est
-- la source, jamais la fiche") : approche simplifiée par rapport à la vision §5 (pas
-- de table d'overrides tracés séparée) — le marquage `source` vit directement sur
-- chaque ligne de ces trois tables ('SUPPLIER' | 'AI_ENRICHED' | 'MANUAL'). Une ligne
-- source='MANUAL' n'est plus jamais écrasée par une re-promotion fournisseur — la
-- garde vit dans la clause WHERE des upserts applicatifs (catalog-promotion.js), pas
-- ici en contrainte SQL (une même ligne peut légitimement changer de source au fil du
-- temps, ex. un admin qui reprend la main sur un champ IA).
--
-- RÉJOUABILITÉ (même doctrine que la désactivation SKU, migration 108) : une section
-- ou un attribut disparu d'un replay est désactivé (is_active=false), jamais supprimé.

CREATE TABLE IF NOT EXISTS public.product_content_profile (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  brand               text,
  short_description   text,
  source              varchar(20) NOT NULL DEFAULT 'SUPPLIER',  -- SUPPLIER | AI_ENRICHED | MANUAL
  enrichment_version  text,
  reviewed            boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.product_content_profile IS
  'Profil éditorial 1:1 par produit (Lot Content) : brand + short_description. '
  'source=MANUAL préserve la ligne contre toute ré-promotion fournisseur (DOCTRINE_CATALOGUE.md §5).';

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_content_profile_product
  ON public.product_content_profile (product_id);

-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.product_content_sections (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  section_key    text NOT NULL,          -- libre, ou réservé : materials | care | warnings
  title          text,
  section_type   varchar(20) NOT NULL DEFAULT 'TEXT',  -- TEXT | HTML | TABLE
  content_json   jsonb,
  display_order  integer,
  source         varchar(20) NOT NULL DEFAULT 'SUPPLIER',
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.product_content_sections IS
  'Sections éditoriales par produit (Lot Content) : sections custom fournisseur + '
  'sections réservées materials/care/warnings. Désactivée jamais supprimée sur '
  'disparition d''un replay (même doctrine que product_skus, migration 108).';

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_content_sections_key
  ON public.product_content_sections (product_id, section_key);

CREATE INDEX IF NOT EXISTS idx_product_content_sections_product_active
  ON public.product_content_sections (product_id) WHERE is_active = true;

-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.product_attributes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  kind           varchar(20) NOT NULL,   -- HIGHLIGHT | SPECIFICATION
  group_key      text NOT NULL DEFAULT '', -- '' pour HIGHLIGHT ; regroupement libre pour SPECIFICATION (défaut applicatif 'general')
                                            -- JAMAIS NULL : NULL n'est jamais égal à NULL dans une contrainte UNIQUE
                                            -- Postgres, ce qui romprait l'idempotence de l'ON CONFLICT applicatif
                                            -- (product_id, kind, group_key, attribute_key) — cf. services/catalog-promotion/content.js
  attribute_key  text NOT NULL,          -- ordinal stable (h1, h2...) pour HIGHLIGHT ; clé métier pour SPECIFICATION
  label          text,
  value_text     text NOT NULL,
  unit           text,
  display_order  integer,
  source         varchar(20) NOT NULL DEFAULT 'SUPPLIER',
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.product_attributes IS
  'Attributs structurés par produit (Lot Content) : points forts (HIGHLIGHT) et '
  'spécifications (SPECIFICATION). Identité (product_id, kind, group_key, '
  'attribute_key) — group_key NOT NULL DEFAULT '''' (jamais NULL) pour que cet index '
  'corresponde exactement à la cible ON CONFLICT (product_id, kind, group_key, '
  'attribute_key) de services/catalog-promotion.js (une expression indexée type '
  'COALESCE ne satisferait pas cette cible ON CONFLICT en colonnes nues).';

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_attributes_triplet
  ON public.product_attributes (product_id, kind, group_key, attribute_key);

CREATE INDEX IF NOT EXISTS idx_product_attributes_product_active
  ON public.product_attributes (product_id) WHERE is_active = true;

-- ─────────────────────────────────────────────────────────────────────
-- Vérification post-migration (à lancer manuellement, lecture seule) :
--
--   SELECT count(*) FROM product_content_profile;   -- attendu : 0
--   SELECT count(*) FROM product_content_sections;   -- attendu : 0
--   SELECT count(*) FROM product_attributes;         -- attendu : 0
--   \d product_content_profile
--   \d product_content_sections
--   \d product_attributes
-- ─────────────────────────────────────────────────────────────────────
