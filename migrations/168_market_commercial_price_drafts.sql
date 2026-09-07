-- @migration 168_market_commercial_price_drafts.sql
-- @domain    market,economic-engine
-- @purpose   Market-owned commercial price decisions in the market currency.
--
-- A local decision NEVER mutates products.price_kmf, which remains the global
-- catalogue/base price. The market manager owns the commercial decision for
-- the market; activation in buyer/order flows is a distinct gate-controlled
-- step. This first slice intentionally persists DRAFT_PENDING_GATE only so a
-- country team can test the decision surface without bypassing pricing gates.

CREATE TABLE IF NOT EXISTS product_market_price_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID NOT NULL REFERENCES markets(id),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  amount NUMERIC(18,4) NOT NULL CHECK (amount > 0),
  currency VARCHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status VARCHAR(40) NOT NULL DEFAULT 'DRAFT_PENDING_GATE'
    CHECK (status IN ('DRAFT_PENDING_GATE')),
  reason TEXT NOT NULL CHECK (char_length(btrim(reason)) >= 3),
  source VARCHAR(80) NOT NULL DEFAULT 'market_manager',
  decided_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (market_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_market_price_drafts_market
  ON product_market_price_drafts (market_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS product_market_price_draft_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID NOT NULL REFERENCES markets(id),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  action VARCHAR(16) NOT NULL CHECK (action IN ('SET', 'RESET')),
  old_amount NUMERIC(18,4),
  new_amount NUMERIC(18,4),
  currency VARCHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reason TEXT NOT NULL CHECK (char_length(btrim(reason)) >= 3),
  source VARCHAR(80) NOT NULL DEFAULT 'market_manager',
  actor_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_market_price_draft_events_market_product
  ON product_market_price_draft_events (market_id, product_id, created_at DESC);

COMMENT ON TABLE product_market_price_drafts IS
  'Current market-owned commercial price draft. Currency is resolved from markets server-side; never supplied as authority by the browser.';

COMMENT ON TABLE product_market_price_draft_events IS
  'Append-only audit of country price draft SET/RESET actions.';
