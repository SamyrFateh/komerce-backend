-- @migration 169_product_market_price_decisions.sql
-- @domain economic-engine
-- @purpose Market-scoped commercial price decisions for the single master catalogue.
-- Products remain global. This table is an economic overlay keyed by
-- (market_id, product_id), never product ownership or catalogue duplication.
-- Superseded/reset decisions are revoked, never deleted, so history is retained.

CREATE TABLE IF NOT EXISTS product_market_price_decisions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id             UUID NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  product_id            UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  price_amount          NUMERIC(14,4) NOT NULL CHECK (price_amount > 0),
  currency              TEXT NOT NULL,
  price_kmf             NUMERIC(14,4) NOT NULL CHECK (price_kmf > 0),
  variable_cost_kmf     NUMERIC(14,4) NOT NULL CHECK (variable_cost_kmf >= 0),
  cdr_complete_kmf      NUMERIC(14,4) NOT NULL CHECK (cdr_complete_kmf >= 0),
  pricing_zone          TEXT NOT NULL CHECK (pricing_zone IN ('at_or_above_cdr', 'under_cdr_contributive')),
  rationale             TEXT NOT NULL CHECK (char_length(btrim(rationale)) BETWEEN 3 AND 1000),
  source                TEXT NOT NULL DEFAULT 'manual_market_decision',

  -- Seulement pour une position contributive sous CDR : preuve du gate qui
  -- autorisait l'OUVERTURE de la position à l'instant de la décision.
  decision_policy_version TEXT,
  coverage_status       TEXT,
  coverage_authorization TEXT,
  coverage_ratio        NUMERIC(18,8),
  coverage_evaluated_at TIMESTAMPTZ,
  coverage_period_from  TIMESTAMPTZ,
  coverage_period_to    TIMESTAMPTZ,
  decision_duration_days INTEGER CHECK (decision_duration_days IS NULL OR decision_duration_days > 0),
  effective_until       TIMESTAMPTZ,

  decided_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at            TIMESTAMPTZ,
  revoked_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  revoke_reason         TEXT,

  CHECK (revoked_at IS NOT NULL OR revoked_by IS NULL),
  CHECK (effective_until IS NULL OR effective_until > decided_at),
  CHECK (
    pricing_zone <> 'under_cdr_contributive'
    OR (
      decision_policy_version IS NOT NULL
      AND coverage_status = 'COVERED'
      AND coverage_authorization = 'ALLOW_NEW_UNDER_CDR_POSITION'
      AND coverage_evaluated_at IS NOT NULL
      AND coverage_period_from IS NOT NULL
      AND coverage_period_to IS NOT NULL
      AND decision_duration_days IS NOT NULL
      AND effective_until IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_market_price_decisions_active
  ON product_market_price_decisions (market_id, product_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_product_market_price_decisions_market_active
  ON product_market_price_decisions (market_id, decided_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_product_market_price_decisions_history
  ON product_market_price_decisions (market_id, product_id, decided_at DESC);

COMMENT ON TABLE product_market_price_decisions IS
  'Market pricing decisions over the single global catalogue. Active row = effective market price; superseded/reset rows are revoked, never deleted.';
COMMENT ON COLUMN product_market_price_decisions.price_amount IS
  'Commercial amount in the server-resolved market currency. Never a catalogue master price.';
COMMENT ON COLUMN product_market_price_decisions.price_kmf IS
  'KMF economic snapshot at decision time for comparison with the canonical economic engine; not a public catalogue ownership field.';
COMMENT ON COLUMN product_market_price_decisions.effective_until IS
  'Mandatory expiry for an under-CDR contributive decision. The gate authorizes opening; it never silently creates an indefinite subsidy.';
