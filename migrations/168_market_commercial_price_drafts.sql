-- @migration 168_market_commercial_price_drafts.sql
-- @domain    market-autonomy,economic-engine
-- @purpose   Market-owned commercial price decisions in the market currency.
--
-- A local decision NEVER mutates products.price_kmf, which remains the global
-- catalogue/base price. Authorization and buyer cutover are distinct states:
-- a price can pass the economic gate without pretending it is already served
-- by catalogue/cart/order flows.

CREATE TABLE IF NOT EXISTS product_market_price_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID NOT NULL REFERENCES markets(id),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  amount NUMERIC(18,4) NOT NULL CHECK (amount > 0),
  currency VARCHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status VARCHAR(48) NOT NULL DEFAULT 'DRAFT_PENDING_GATE'
    CHECK (status IN (
      'DRAFT_PENDING_GATE',
      'LOCAL_AUTHORIZED_PENDING_CUTOVER',
      'LOCAL_ACTIVE'
    )),
  reason TEXT NOT NULL CHECK (char_length(btrim(reason)) >= 3),
  source VARCHAR(80) NOT NULL DEFAULT 'market_manager',
  decided_by UUID REFERENCES users(id),
  authorized_at TIMESTAMPTZ,
  authorization_snapshot JSONB,
  active_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (market_id, product_id),
  CONSTRAINT product_market_price_authorization_state_check CHECK (
    (status = 'DRAFT_PENDING_GATE' AND authorized_at IS NULL AND authorization_snapshot IS NULL AND active_at IS NULL)
    OR
    (status = 'LOCAL_AUTHORIZED_PENDING_CUTOVER' AND authorized_at IS NOT NULL AND authorization_snapshot IS NOT NULL AND active_at IS NULL)
    OR
    (status = 'LOCAL_ACTIVE' AND authorized_at IS NOT NULL AND authorization_snapshot IS NOT NULL AND active_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_product_market_price_drafts_market
  ON product_market_price_drafts (market_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_market_price_drafts_market_status
  ON product_market_price_drafts (market_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS product_market_price_draft_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID NOT NULL REFERENCES markets(id),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  action VARCHAR(16) NOT NULL CHECK (action IN ('SET', 'RESET', 'AUTHORIZE', 'ACTIVATE')),
  old_amount NUMERIC(18,4),
  new_amount NUMERIC(18,4),
  currency VARCHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  old_status VARCHAR(48),
  new_status VARCHAR(48),
  decision_snapshot JSONB,
  reason TEXT NOT NULL CHECK (char_length(btrim(reason)) >= 3),
  source VARCHAR(80) NOT NULL DEFAULT 'market_manager',
  actor_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_market_price_draft_events_market_product
  ON product_market_price_draft_events (market_id, product_id, created_at DESC);

COMMENT ON TABLE product_market_price_drafts IS
  'Current market-owned commercial price decision. Currency is resolved from markets server-side; economic authorization is distinct from buyer cutover.';
COMMENT ON COLUMN product_market_price_drafts.authorization_snapshot IS
  'Immutable-at-authorization evidence snapshot: local->KMF projection, CDR and market gate decision used to authorize this exact amount.';
COMMENT ON TABLE product_market_price_draft_events IS
  'Append-only audit of country price SET/RESET/AUTHORIZE/ACTIVATE actions.';
