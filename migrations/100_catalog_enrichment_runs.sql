-- @migration 100_catalog_enrichment_runs.sql
-- @domain    catalog
-- @purpose   K-3 : traces des runs d'enrichissement IA (échecs + coût suivis),
--            marquage needs_review / confiance sur products.

-- ============================================================================
--  100_catalog_enrichment_runs.sql
--  Doctrine : DOCTRINE_CATALOGUE.md (§4 enrichissement FR, §8 IA sous gouvernance)
--
--  PRINCIPE (§8) : "échecs tracés, coût par produit suivi". Chaque appel au
--  modèle — réussi, refusé ou planté — laisse une ligne ici. Le coût se lit
--  en tokens (input/output) : pas de conversion monétaire en DB, le tarif
--  du modèle change, les tokens non.
--
--  APPLICATION SANS CONTRAINTE (pattern 095/098) : colonnes nullables sur
--  products, aucun trigger, aucun CHECK sur l'existant. La table NEUVE porte
--  ses propres garde-fous.
--
--  Idempotente : IF NOT EXISTS partout.
-- ============================================================================

SET client_encoding = 'UTF8';

-- ── 1. Marquage review sur products (doctrine §4 : sous le seuil → needs_review)

ALTER TABLE products ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS enrichment_confidence numeric(4,3);

COMMENT ON COLUMN products.needs_review IS
  'Fiche à relire humainement : confiance IA sous CATALOG_ENRICH_CONFIDENCE_MIN, '
  'ou enrichissement en échec (fiche restée en donnée source). Champ de CUISINE : '
  'la boutique ne le lit jamais (catalog-public-view.js).';
COMMENT ON COLUMN products.enrichment_confidence IS
  'Score de confiance (0..1) déclaré par le dernier enrichissement IA appliqué. '
  'NULL = jamais enrichie. Champ de cuisine, invisible boutique.';

-- ── 2. Traces des runs (doctrine §8 : le prompt est du code, l''appel est tracé)

CREATE TABLE IF NOT EXISTS catalog_enrichment_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     uuid REFERENCES products(id) ON DELETE SET NULL,
  prompt_version integer NOT NULL,          -- PROMPT_VERSION du module prompt (repo)
  model          text NOT NULL,             -- modèle effectivement appelé
  status         varchar(20) NOT NULL,      -- ok | low_confidence | invalid_output | failed
  confidence     numeric(4,3),              -- déclarée par le modèle (NULL si failed)
  input_tokens   integer,                   -- coût : usage.input_tokens
  output_tokens  integer,                   -- coût : usage.output_tokens
  duration_ms    integer,
  error          text,                      -- message d'échec (failed / invalid_output)
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_enrichment_runs_status_check
    CHECK (status IN ('ok', 'low_confidence', 'invalid_output', 'failed'))
);

COMMENT ON TABLE catalog_enrichment_runs IS
  'Trace de chaque appel d''enrichissement IA (doctrine catalogue §8 : échecs '
  'tracés, coût par produit suivi en tokens). ok = appliqué ; low_confidence = '
  'appliqué + needs_review ; invalid_output = JSON hors schéma, rien appliqué ; '
  'failed = erreur réseau/modèle, rien appliqué.';

CREATE INDEX IF NOT EXISTS idx_enrichment_runs_product
  ON catalog_enrichment_runs(product_id, created_at DESC);

-- ── Vérification post-migration (lecture seule) ──────────────────────────────
-- SELECT count(*) FROM products WHERE needs_review;                 -- attendu : 0 (aucun run encore)
-- SELECT count(*) FROM catalog_enrichment_runs;                     -- attendu : 0

DO $$
BEGIN
  RAISE NOTICE 'Migration 100 OK : traces enrichissement IA (K-3) — cuisine invisible boutique, 0 contrainte sur l''existant';
END $$;
