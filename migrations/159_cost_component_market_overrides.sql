-- @migration 159_cost_component_market_overrides.sql
-- @domain economic-engine
-- @purpose Market-scoped overrides for the canonical cost workshop.
-- Global cost_components remain the structural/base model. A market may
-- override only value/activation; missing override inherits the global row.

CREATE TABLE IF NOT EXISTS cost_component_market_overrides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id       UUID NOT NULL REFERENCES markets(id),
  component_id    UUID NOT NULL REFERENCES cost_components(id),
  default_value   NUMERIC(14,4),
  is_active       BOOLEAN,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (market_id, component_id),
  CHECK (default_value IS NULL OR default_value >= 0)
);

CREATE INDEX IF NOT EXISTS idx_cost_component_market_overrides_market
  ON cost_component_market_overrides (market_id, component_id);

CREATE TABLE IF NOT EXISTS cost_component_market_override_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  override_id     UUID REFERENCES cost_component_market_overrides(id) ON DELETE SET NULL,
  market_id       UUID NOT NULL REFERENCES markets(id),
  component_id    UUID REFERENCES cost_components(id) ON DELETE SET NULL,
  component_key   TEXT NOT NULL,
  event_type      TEXT NOT NULL CHECK (event_type IN ('created', 'updated', 'reset')),
  old_value       JSONB,
  new_value       JSONB,
  notes           TEXT,
  triggered_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cost_component_market_override_events_market
  ON cost_component_market_override_events (market_id, created_at DESC);

COMMENT ON TABLE cost_component_market_overrides IS
  'Market-specific value/activation overrides for global cost_components. No row = inherit global.';
COMMENT ON TABLE cost_component_market_override_events IS
  'Append-only audit trail for market cost model changes and resets.';
