-- ============================================================
-- 168 — Pricing market decision policy events
-- ============================================================
-- Objet :
--   Matérialiser la politique canonique qui gouverne la fenêtre du gate
--   économique d'un marché et ses seuils de décision, sans fallback caché.
--
-- Doctrine : DOCTRINE_PRICING_ANCRE_MARCHE_VIABILITE.md
--
-- Invariants :
--   - market-scoped : aucune politique groupe ne masque un marché ;
--   - append-only : toute évolution crée un nouvel événement ;
--   - aucun seuil par défaut n'est fabriqué en DB ;
--   - fenêtre, maturité, couverture et plafond de dispositions sont explicites ;
--   - le traitement des dispositions reste conservateur ;
--   - source, preuve, justification et auteur sont obligatoires ;
--   - l'activation peut être immédiate ou planifiée, jamais rétroactive via UPDATE.

CREATE TABLE IF NOT EXISTS pricing_market_decision_policy_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,

  version TEXT NOT NULL
    CHECK (char_length(btrim(version)) BETWEEN 1 AND 100),

  window_days INTEGER NOT NULL CHECK (window_days > 0),
  maturity_threshold NUMERIC(7,6) NOT NULL
    CHECK (maturity_threshold >= 0 AND maturity_threshold <= 1),
  coverage_threshold NUMERIC(12,6) NOT NULL
    CHECK (coverage_threshold > 0),
  max_disposition_ratio NUMERIC(7,6) NOT NULL
    CHECK (max_disposition_ratio >= 0 AND max_disposition_ratio <= 1),

  disposed_contribution_treatment TEXT NOT NULL
    DEFAULT 'EXCLUDE_FROM_NUMERATOR'
    CHECK (disposed_contribution_treatment = 'EXCLUDE_FROM_NUMERATOR'),

  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ NULL,

  source TEXT NOT NULL
    CHECK (char_length(btrim(source)) BETWEEN 3 AND 500),
  evidence_ref TEXT NOT NULL
    CHECK (char_length(btrim(evidence_ref)) BETWEEN 3 AND 1000),
  rationale TEXT NOT NULL
    CHECK (char_length(btrim(rationale)) BETWEEN 10 AND 2000),

  recorded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pricing_market_decision_policy_period_check
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT pricing_market_decision_policy_version_unique
    UNIQUE (market_id, version),
  CONSTRAINT pricing_market_decision_policy_start_unique
    UNIQUE (market_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_pricing_market_decision_policy_current
  ON pricing_market_decision_policy_events (market_id, effective_from DESC, recorded_at DESC, id DESC);

CREATE OR REPLACE FUNCTION prevent_pricing_market_decision_policy_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'pricing_market_decision_policy_events is append-only; record a new policy event instead';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_pricing_market_decision_policy_mutation
  ON pricing_market_decision_policy_events;
CREATE TRIGGER trg_prevent_pricing_market_decision_policy_mutation
BEFORE UPDATE OR DELETE ON pricing_market_decision_policy_events
FOR EACH ROW EXECUTE FUNCTION prevent_pricing_market_decision_policy_mutation();

COMMENT ON TABLE pricing_market_decision_policy_events IS
  'Politique append-only du gate économique par marché : fenêtre mécanique, seuil de maturité, seuil de couverture et plafond de dispositions. Aucune valeur implicite.';
COMMENT ON COLUMN pricing_market_decision_policy_events.window_days IS
  'Largeur mécanique de la fenêtre canonique ; les dates du gate sont dérivées côté serveur et ne sont jamais choisies ad hoc par le navigateur.';
COMMENT ON COLUMN pricing_market_decision_policy_events.coverage_threshold IS
  'Seuil explicite de market_coverage_ratio autorisant une nouvelle position sous CDR ; toute modification est un nouvel événement auditable.';
