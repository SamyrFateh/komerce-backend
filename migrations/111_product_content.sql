-- @migration 111_product_content.sql
-- @domain    catalog
-- @purpose   Fiche produit enrichie — modèle canonique du contenu éditorial
--            (brand, short_description, highlights, specifications, sections,
--            materials, care, warnings, provenance), cible de promotion depuis
--            normalized_source_contract V2.
-- @added-header 2026-07-16
-- Idempotent : peut être rejoué sans risque.
--
-- Portée : schéma uniquement. Aucune écriture applicative ne pointe encore
-- vers ces tables après cette migration — le service de promotion (commit 3)
-- est le seul futur écrivain, le Product Detail Contract (commit 2) le seul
-- futur lecteur.
--
-- CHOIX DE MODÉLISATION (documenté explicitement, cf. doctrine "pas dix
-- colonnes disparates") :
--   - product_content_profile porte les champs scalaires 1:1 (brand,
--     short_description) + la provenance globale exposée par le contrat
--     public (content.provenance).
--   - product_content_sections porte À LA FOIS les sections éditoriales
--     libres ET materials/care/warnings, via des section_key réservés
--     ('MATERIALS', 'CARE', 'WARNINGS') de type BULLETS. Le service de
--     projection (buildContent) aplatit ces clés réservées vers
--     content.materials/care/warnings et route le reste vers
--     content.sections[]. Une seule table, pas quatre.
--   - product_attributes porte highlights (kind='HIGHLIGHT') et
--     specifications (kind='SPECIFICATION') — deux natures de la même
--     forme clé/label/valeur/ordre.
--
-- Aucune de ces tables ne porte de JSON libre sans schéma : content_json
-- de product_content_sections est validé par le service de projection selon
-- section_type avant de traverser le contrat public v1.

-- ─────────────────────────────────────────────────────────────────────
--  1. product_content_profile — 1:1 avec products.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.product_content_profile (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  brand               text,
  short_description   text,
  source              varchar(20) NOT NULL DEFAULT 'SUPPLIER',
  enrichment_version  text,
  reviewed            boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_content_profile_source_check
    CHECK (source IN ('SUPPLIER', 'AI_ENRICHED', 'MANUAL')),
  CONSTRAINT product_content_profile_brand_len
    CHECK (brand IS NULL OR char_length(brand) <= 200),
  CONSTRAINT product_content_profile_short_desc_len
    CHECK (short_description IS NULL OR char_length(short_description) <= 500)
);

COMMENT ON TABLE public.product_content_profile IS
  'Profil éditorial 1:1 par produit (fiche produit enrichie). Porte brand, '
  'short_description et la provenance globale exposée par '
  'product_detail_v1.content.provenance. Cible de promotion depuis '
  'normalized_source_contract V2, jamais servi depuis le raw_payload.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_content_profile_product
  ON public.product_content_profile (product_id);

DROP TRIGGER IF EXISTS trg_product_content_profile_updated ON public.product_content_profile;

CREATE TRIGGER trg_product_content_profile_updated
  BEFORE UPDATE ON public.product_content_profile
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
--  2. product_content_sections — sections éditoriales + materials/
--     care/warnings (section_key réservés, cf. note de modélisation).
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.product_content_sections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  section_key         varchar(128) NOT NULL,
  title               text NOT NULL,
  section_type        varchar(20) NOT NULL,
  content_json        jsonb NOT NULL,
  display_order       integer NOT NULL DEFAULT 0,
  source              varchar(20) NOT NULL DEFAULT 'SUPPLIER',
  enrichment_version  text,
  reviewed            boolean NOT NULL DEFAULT false,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_content_sections_type_check
    CHECK (section_type IN ('TEXT', 'BULLETS', 'KEY_VALUE')),
  CONSTRAINT product_content_sections_source_check
    CHECK (source IN ('SUPPLIER', 'AI_ENRICHED', 'MANUAL')),
  CONSTRAINT product_content_sections_content_json_object
    CHECK (jsonb_typeof(content_json) = 'object')
);

COMMENT ON TABLE public.product_content_sections IS
  'Sections éditoriales structurées (fiche produit enrichie). section_key '
  'réservés MATERIALS/CARE/WARNINGS (toujours BULLETS) sont aplatis par '
  'buildContent() vers content.materials/care/warnings ; tout autre '
  'section_key alimente content.sections[]. Ré-promotion idempotente via '
  'la contrainte UNIQUE(product_id, section_key).';

COMMENT ON COLUMN public.product_content_sections.content_json IS
  'Forme dépendant de section_type : {"text": string} pour TEXT, '
  '{"items": string[]} pour BULLETS, {"entries": [{"label","value"}]} pour '
  'KEY_VALUE. Validé par le service de projection avant de traverser le '
  'contrat public — jamais rendu comme HTML brut.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_content_sections_key
  ON public.product_content_sections (product_id, section_key);

CREATE INDEX IF NOT EXISTS idx_product_content_sections_product
  ON public.product_content_sections (product_id, display_order)
  WHERE is_active = true;

DROP TRIGGER IF EXISTS trg_product_content_sections_updated ON public.product_content_sections;

CREATE TRIGGER trg_product_content_sections_updated
  BEFORE UPDATE ON public.product_content_sections
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
--  3. product_attributes — highlights (kind=HIGHLIGHT) et
--     specifications (kind=SPECIFICATION).
--     group_key NOT NULL DEFAULT '' : une valeur vide plutôt que NULL,
--     pour que la contrainte UNIQUE ci-dessous s'applique aussi aux
--     highlights (sans groupe) — NULL ne serait jamais égal à NULL dans
--     un index unique Postgres et casserait l'idempotence de l'upsert.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.product_attributes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  kind            varchar(20) NOT NULL,
  group_key       text NOT NULL DEFAULT '',
  attribute_key   varchar(128) NOT NULL,
  label           text NOT NULL,
  value_text      text,
  unit            varchar(50),
  display_order   integer NOT NULL DEFAULT 0,
  source          varchar(20) NOT NULL DEFAULT 'SUPPLIER',
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_attributes_kind_check
    CHECK (kind IN ('HIGHLIGHT', 'SPECIFICATION')),
  CONSTRAINT product_attributes_source_check
    CHECK (source IN ('SUPPLIER', 'AI_ENRICHED', 'MANUAL')),
  CONSTRAINT product_attributes_highlight_no_value
    CHECK (kind <> 'HIGHLIGHT' OR value_text IS NULL)
);

COMMENT ON TABLE public.product_attributes IS
  'Attributs structurés clé/label/valeur (fiche produit enrichie). '
  'kind=HIGHLIGHT alimente content.highlights (label seul, pas de valeur). '
  'kind=SPECIFICATION alimente content.specifications (group/key/label/'
  'value/unit). Ré-promotion idempotente via UNIQUE(product_id, kind, '
  'group_key, attribute_key).';

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_attributes_identity
  ON public.product_attributes (product_id, kind, group_key, attribute_key);

CREATE INDEX IF NOT EXISTS idx_product_attributes_product
  ON public.product_attributes (product_id, kind, display_order)
  WHERE is_active = true;

DROP TRIGGER IF EXISTS trg_product_attributes_updated ON public.product_attributes;

CREATE TRIGGER trg_product_attributes_updated
  BEFORE UPDATE ON public.product_attributes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- Vérification post-migration (à lancer manuellement, lecture seule) :
--
--   SELECT count(*) FROM product_content_profile;   -- attendu : 0
--   SELECT count(*) FROM product_content_sections;  -- attendu : 0
--   SELECT count(*) FROM product_attributes;        -- attendu : 0
--   \d product_content_profile
--   \d product_content_sections
--   \d product_attributes
-- ─────────────────────────────────────────────────────────────────────
