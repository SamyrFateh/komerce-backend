-- @migration 219_decision_signals_market_scope.sql
-- @domain    decision-signals
-- @purpose   Give decision signals an explicit canonical Market ID dimension
--            without inventing authority for historical/global facts.
--
-- Historical rows remain market_id = NULL by design: NULL means a genuinely
-- global signal. A non-NULL market_id is server-owned authority and must only
-- be supplied after the server has resolved the target market.

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS market_id UUID NULL REFERENCES markets(id) ON DELETE RESTRICT;

COMMENT ON COLUMN signals.market_id IS
  'Canonical Market ID scope for a derived signal. NULL = global fact; non-NULL = exact server-resolved market fact. Browser input is never authoritative.';

DROP INDEX IF EXISTS idx_signals_active_fact_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_active_fact_unique
  ON signals(signal_type, market_id, entity_type, entity_id) NULLS NOT DISTINCT
  WHERE status IN ('open','acknowledged','snoozed');

CREATE INDEX IF NOT EXISTS idx_signals_market_active_created
  ON signals(market_id, status, created_at DESC)
  WHERE status IN ('open','acknowledged','snoozed');

CREATE INDEX IF NOT EXISTS idx_signals_market_severity_created
  ON signals(market_id, severity, created_at DESC);
