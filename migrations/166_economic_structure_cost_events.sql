-- ============================================================
-- 166 — Economic structure cost events (N3 period truth)
-- ============================================================
-- Objet :
--   Matérialiser la vérité économique de période des charges de structure
--   sans transformer la table `charges` (configuration) en faux réel et sans
--   encore inventer une clé de mutualisation des pools groupe vers les marchés.
--
-- Doctrine : DOCTRINE_PRICING_ANCRE_MARCHE_VIABILITE.md V1.3
--
-- Invariants :
--   - append-only : toute correction passe par ADJUSTMENT / REVERSAL ;
--   - `charges` reste une configuration/référence, jamais une preuve réelle ;
--   - GROUP = pool partagé non encore attribué ;
--   - MARKET_DIRECT = charge directement attribuable à un marché, sans prorata ;
--   - aucune allocation GROUP -> marché n'est effectuée par cette table ;
--   - une preuve externe (`evidence_ref`) et l'auteur sont obligatoires ;
--   - la période économique est explicite [economic_from, economic_to).

CREATE TABLE IF NOT EXISTS economic_structure_cost_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id UUID NOT NULL REFERENCES charges(id) ON DELETE RESTRICT,

  scope_kind TEXT NOT NULL
    CHECK (scope_kind IN ('GROUP', 'MARKET_DIRECT')),
  market_id UUID NULL REFERENCES markets(id) ON DELETE RESTRICT,

  event_kind TEXT NOT NULL
    CHECK (event_kind IN ('ACCRUAL', 'ADJUSTMENT', 'REVERSAL')),
  adjusts_event_id UUID NULL
    REFERENCES economic_structure_cost_events(id) ON DELETE RESTRICT,

  economic_from TIMESTAMPTZ NOT NULL,
  economic_to TIMESTAMPTZ NOT NULL,

  amount_original NUMERIC(18,4) NOT NULL,
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  fx_rate_to_kmf NUMERIC(18,6) NOT NULL CHECK (fx_rate_to_kmf > 0),
  fx_source TEXT NOT NULL CHECK (char_length(btrim(fx_source)) BETWEEN 2 AND 200),
  amount_kmf NUMERIC(18,2) NOT NULL CHECK (amount_kmf <> 0),

  source_kind TEXT NOT NULL
    CHECK (source_kind IN ('INVOICE', 'CONTRACT', 'CONNECTOR', 'MANUAL', 'ADJUSTMENT')),
  evidence_ref TEXT NOT NULL
    CHECK (char_length(btrim(evidence_ref)) BETWEEN 3 AND 1000),
  notes TEXT NULL CHECK (notes IS NULL OR char_length(notes) <= 2000),

  recorded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT economic_structure_cost_events_period_check
    CHECK (economic_to > economic_from),
  CONSTRAINT economic_structure_cost_events_scope_market_check
    CHECK (
      (scope_kind = 'GROUP' AND market_id IS NULL)
      OR
      (scope_kind = 'MARKET_DIRECT' AND market_id IS NOT NULL)
    ),
  CONSTRAINT economic_structure_cost_events_sign_check
    CHECK (
      (event_kind = 'ACCRUAL' AND amount_kmf > 0 AND amount_original > 0)
      OR
      (event_kind = 'REVERSAL' AND amount_kmf < 0 AND amount_original < 0)
      OR
      (event_kind = 'ADJUSTMENT' AND amount_kmf <> 0 AND amount_original <> 0)
    ),
  CONSTRAINT economic_structure_cost_events_adjustment_link_check
    CHECK (
      (event_kind = 'ACCRUAL' AND adjusts_event_id IS NULL)
      OR
      (event_kind IN ('ADJUSTMENT', 'REVERSAL') AND adjusts_event_id IS NOT NULL)
    ),
  CONSTRAINT economic_structure_cost_events_kmf_fx_check
    CHECK (currency <> 'KMF' OR fx_rate_to_kmf = 1)
);

CREATE INDEX IF NOT EXISTS idx_structure_cost_events_period
  ON economic_structure_cost_events (economic_from, economic_to);

CREATE INDEX IF NOT EXISTS idx_structure_cost_events_scope_period
  ON economic_structure_cost_events (scope_kind, market_id, economic_from, economic_to);

CREATE INDEX IF NOT EXISTS idx_structure_cost_events_charge_time
  ON economic_structure_cost_events (charge_id, recorded_at DESC, id DESC);

CREATE OR REPLACE FUNCTION prevent_economic_structure_cost_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'economic_structure_cost_events is append-only; record an ADJUSTMENT or REVERSAL event';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_economic_structure_cost_event_mutation
  ON economic_structure_cost_events;
CREATE TRIGGER trg_prevent_economic_structure_cost_event_mutation
BEFORE UPDATE OR DELETE ON economic_structure_cost_events
FOR EACH ROW EXECUTE FUNCTION prevent_economic_structure_cost_event_mutation();

COMMENT ON TABLE economic_structure_cost_events IS
  'Vérité append-only des charges économiques N3 de période. GROUP reste non alloué ; MARKET_DIRECT est directement attribuable à un marché.';
COMMENT ON COLUMN economic_structure_cost_events.amount_kmf IS
  'Montant économique en KMF pour toute la période de l’événement ; ne provient jamais automatiquement de charges.amount_kmf.';
COMMENT ON COLUMN economic_structure_cost_events.adjusts_event_id IS
  'Lien obligatoire vers l’événement corrigé pour ADJUSTMENT/REVERSAL ; aucune mutation du réel historique.';
