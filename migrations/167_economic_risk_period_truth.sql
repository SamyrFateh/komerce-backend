-- ============================================================
-- 167 — Economic risk period truth (N2 risk reconciliation)
-- ============================================================
-- Objet :
--   Matérialiser la vérité réalisée des coûts de risque par marché et le
--   watermark de revue qui permet de distinguer explicitement "zéro perte"
--   de "aucune donnée de risque".
--
-- Doctrine : DOCTRINE_PRICING_ANCRE_MARCHE_VIABILITE.md V1.3
--
-- Invariants :
--   - `risk_provisions` reste une configuration/provision, jamais une preuve
--     de sinistre réalisé ;
--   - les coûts de risque réalisés sont append-only ;
--   - toute correction passe par ADJUSTMENT / REVERSAL ;
--   - le market_id est obligatoire : le gate de couverture est local ;
--   - un watermark de revue explicite est nécessaire pour certifier une
--     période, y compris quand son coût de risque réalisé est zéro ;
--   - un fait backdaté enregistré après le watermark rend la période stale
--     jusqu'à une nouvelle certification ;
--   - aucun seuil de couverture ni aucune politique prix dans ces tables.

CREATE TABLE IF NOT EXISTS economic_risk_cost_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  order_id UUID NULL REFERENCES orders(id) ON DELETE RESTRICT,
  risk_provision_id UUID NULL REFERENCES risk_provisions(id) ON DELETE RESTRICT,

  risk_key_snapshot TEXT NOT NULL
    CHECK (char_length(btrim(risk_key_snapshot)) BETWEEN 1 AND 200),
  risk_label_snapshot TEXT NOT NULL
    CHECK (char_length(btrim(risk_label_snapshot)) BETWEEN 1 AND 300),

  event_kind TEXT NOT NULL
    CHECK (event_kind IN ('ACCRUAL', 'ADJUSTMENT', 'REVERSAL')),
  adjusts_event_id UUID NULL
    REFERENCES economic_risk_cost_events(id) ON DELETE RESTRICT,

  -- Date économique du sinistre / de la perte. Une correction garde la date
  -- économique du fait original ; elle ne déplace pas silencieusement la perte
  -- vers une autre fenêtre.
  economic_at TIMESTAMPTZ NOT NULL,

  amount_original NUMERIC(18,4) NOT NULL,
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  fx_rate_to_kmf NUMERIC(18,6) NOT NULL CHECK (fx_rate_to_kmf > 0),
  fx_source TEXT NOT NULL CHECK (char_length(btrim(fx_source)) BETWEEN 2 AND 200),
  amount_kmf NUMERIC(18,2) NOT NULL CHECK (amount_kmf <> 0),

  -- Source volontairement extensible : REFUND, DISPUTE, INCIDENT,
  -- CASH_SHORTFALL, COMPENSATION, MANUAL, etc. La preuve reste obligatoire.
  source_kind TEXT NOT NULL
    CHECK (char_length(btrim(source_kind)) BETWEEN 2 AND 100),
  evidence_ref TEXT NOT NULL
    CHECK (char_length(btrim(evidence_ref)) BETWEEN 3 AND 1000),
  notes TEXT NULL CHECK (notes IS NULL OR char_length(notes) <= 2000),

  recorded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT economic_risk_cost_events_sign_check
    CHECK (
      (event_kind = 'ACCRUAL' AND amount_kmf > 0 AND amount_original > 0)
      OR
      (event_kind = 'REVERSAL' AND amount_kmf < 0 AND amount_original < 0)
      OR
      (event_kind = 'ADJUSTMENT' AND amount_kmf <> 0 AND amount_original <> 0)
    ),
  CONSTRAINT economic_risk_cost_events_adjustment_link_check
    CHECK (
      (event_kind = 'ACCRUAL' AND adjusts_event_id IS NULL)
      OR
      (event_kind IN ('ADJUSTMENT', 'REVERSAL') AND adjusts_event_id IS NOT NULL)
    ),
  CONSTRAINT economic_risk_cost_events_kmf_fx_check
    CHECK (currency <> 'KMF' OR fx_rate_to_kmf = 1)
);

CREATE INDEX IF NOT EXISTS idx_economic_risk_cost_market_time
  ON economic_risk_cost_events (market_id, economic_at, recorded_at);
CREATE INDEX IF NOT EXISTS idx_economic_risk_cost_order
  ON economic_risk_cost_events (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_economic_risk_cost_provision
  ON economic_risk_cost_events (risk_provision_id) WHERE risk_provision_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_economic_risk_cost_adjusts
  ON economic_risk_cost_events (adjusts_event_id) WHERE adjusts_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS economic_risk_watermark_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  closed_through TIMESTAMPTZ NOT NULL,
  review_version TEXT NOT NULL
    CHECK (char_length(btrim(review_version)) BETWEEN 1 AND 100),
  source TEXT NOT NULL
    CHECK (char_length(btrim(source)) BETWEEN 3 AND 500),
  evidence_ref TEXT NOT NULL
    CHECK (char_length(btrim(evidence_ref)) BETWEEN 3 AND 1000),
  notes TEXT NULL CHECK (notes IS NULL OR char_length(notes) <= 2000),
  recorded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_economic_risk_watermark_market
  ON economic_risk_watermark_events (market_id, closed_through DESC, recorded_at DESC, id DESC);

CREATE OR REPLACE FUNCTION prevent_economic_risk_truth_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; record a new economic event instead', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_economic_risk_cost_event_mutation
  ON economic_risk_cost_events;
CREATE TRIGGER trg_prevent_economic_risk_cost_event_mutation
BEFORE UPDATE OR DELETE ON economic_risk_cost_events
FOR EACH ROW EXECUTE FUNCTION prevent_economic_risk_truth_mutation();

DROP TRIGGER IF EXISTS trg_prevent_economic_risk_watermark_event_mutation
  ON economic_risk_watermark_events;
CREATE TRIGGER trg_prevent_economic_risk_watermark_event_mutation
BEFORE UPDATE OR DELETE ON economic_risk_watermark_events
FOR EACH ROW EXECUTE FUNCTION prevent_economic_risk_truth_mutation();

COMMENT ON TABLE economic_risk_cost_events IS
  'Vérité append-only des pertes/sinistres réalisés N2 par marché. risk_provisions reste une configuration ; aucune absence de ligne ne vaut zéro.';
COMMENT ON TABLE economic_risk_watermark_events IS
  'Certifications append-only de revue du risque par marché. Un closed_through explicite permet de prouver un zéro réalisé sans inventer un événement de coût nul.';
COMMENT ON COLUMN economic_risk_cost_events.economic_at IS
  'Date économique du risque réalisé ; les corrections gardent la date du fait original afin de ne pas déplacer le coût entre fenêtres.';
COMMENT ON COLUMN economic_risk_watermark_events.closed_through IS
  'Borne exclusive de risque revue/certifiée. Toute écriture backdatée ultérieure dans une fenêtre déjà certifiée rend cette certification stale jusqu à une nouvelle revue.';
