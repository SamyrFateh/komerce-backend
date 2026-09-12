-- ============================================================
-- Migration 192 : observations de prix marché par pays
-- Date : 2026-09-08
--
-- Doctrine :
--   - le marché borne le possible ; il ne remplace pas la vérité des coûts ;
--   - une observation pays reste séparée des observations concurrence globales ;
--   - le navigateur ne fournit jamais market_id : il est résolu côté serveur ;
--   - le corridor basse / cible / haute est une projection de faits observés,
--     jamais un gate automatique ni un prix imposé au manager pays ;
--   - chaque mutation est auditée dans un journal append-only.
-- ============================================================

CREATE TABLE IF NOT EXISTS market_price_observations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_ref  TEXT UNIQUE NOT NULL,
  market_id        UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  product_id       UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category         TEXT,
  competitor_name  TEXT NOT NULL,
  observed_amount  NUMERIC(14,4) NOT NULL CHECK (observed_amount > 0),
  currency         TEXT NOT NULL,
  price_kmf        NUMERIC(14,4) NOT NULL CHECK (price_kmf > 0),
  observed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source           TEXT NOT NULL DEFAULT 'market_manager',
  notes            TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_price_observations_market_product
  ON market_price_observations (market_id, product_id, observed_at DESC)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_market_price_observations_market_category
  ON market_price_observations (market_id, category, observed_at DESC)
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS market_price_observation_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id   UUID REFERENCES market_price_observations(id) ON DELETE SET NULL,
  observation_ref  TEXT NOT NULL,
  market_id        UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  product_id       UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  action           TEXT NOT NULL CHECK (action IN ('RECORDED', 'DEACTIVATED')),
  snapshot         JSONB NOT NULL,
  reason           TEXT,
  actor_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_price_observation_events_market
  ON market_price_observation_events (market_id, created_at DESC);

COMMENT ON TABLE market_price_observations IS
  'Observed local market prices. Market scope is resolved server-side; corridor projection is informative evidence, not an automatic pricing gate.';

COMMENT ON TABLE market_price_observation_events IS
  'Append-only audit trail for local market price observations.';
