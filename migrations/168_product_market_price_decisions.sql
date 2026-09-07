-- @migration 168_product_market_price_decisions.sql
-- @domain economic-engine
-- @purpose Market-scoped commercial price decisions for the single master catalogue.
-- Products remain global. This table is an economic overlay keyed by
-- (market_id, product_id), never product ownership or catalogue duplication.

CREATE TABLE IF NOT EXISTS product_market_price_decisions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id             UUID NOT NULL REFERENCES markets(id),
  product_id            UUID NOT NULL REFERENCES products(id),
  price_amount          NUMERIC(14,4) NOT NULL CHECK (price_amount > 0),
  currency              TEXT NOT NULL,
  price_kmf             NUMERIC(14,4) NOT NULL CHECK (price_kmf > 0),
  variable_cost_kmf     NUMERIC(14,4) NOT NULL CHECK (variable_cost_kmf >= 0),
  cdr_complete_kmf      NUMERIC(14,4) NOT NULL CHECK (cdr_complete_kmf >= 0),
  pricing_zone          TEXT NOT NULL CHECK (pricing_zone IN ('at_or_above_cdr', 'under_cdr_contributive')),
  rationale             TEXT NOT NULL,
  source                TEXT NOT NULL DEFAULT 'manual_market_decision',
  decided_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at            TIMESTAMPTZ,
  revoked_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  revoke_reason         TEXT,
  CHECK (revoked_at IS NOT NULL OR revoked_by IS NULL)
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
  'Append-only market pricing decisions over the single global catalogue. Active row = effective market price; revoked rows remain audit history.';
COMMENT ON COLUMN product_market_price_decisions.price_amount IS
  'Commercial amount in the server-resolved market currency. Never a catalogue master price.';
COMMENT ON COLUMN product_market_price_decisions.price_kmf IS
  'KMF economic snapshot at decision time for comparison with the canonical economic engine; not a public catalogue ownership field.';
