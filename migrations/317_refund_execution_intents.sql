-- @migration 317_refund_execution_intents.sql
-- @domain refunds
-- @purpose RC-5/RC-9 foundation, durable provider-operation intentions. CREATE only:
-- no automatic payment execution, retroactive reconciliation, destructive backfill, or RESET.
-- Doctrine: transaction durable before PSP, stable provider key, no implicit retry on UNKNOWN.
--
-- Rollback on an EMPTY newly provisioned database only: DROP TABLE refund_execution_intents;
-- NEVER drop this table if it holds provider operations or pending intentions.
CREATE TABLE IF NOT EXISTS refund_execution_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  market_id UUID NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('stripe', 'paypal')),
  capture_ref TEXT NOT NULL CHECK (length(trim(capture_ref)) > 0),
  operation_key TEXT NOT NULL CHECK (length(trim(operation_key)) > 0),
  amount_eur NUMERIC(12,2) NOT NULL CHECK (amount_eur > 0),
  currency CHAR(3) NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'processing', 'unknown', 'confirmed', 'failed')),
  provider_ref TEXT,
  initiated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_refund_intents_provider_operation UNIQUE (provider, operation_key),
  CONSTRAINT chk_refund_intents_confirmed_ref
    CHECK (status <> 'confirmed' OR (provider_ref IS NOT NULL AND length(trim(provider_ref)) > 0))
);
-- One unresolved external operation per order. New partial refunds can be
-- reserved only AFTER the previous provider operation is reconciled.
CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_intents_one_unresolved_order
  ON refund_execution_intents (order_id)
  WHERE status IN ('reserved', 'processing', 'unknown');

CREATE INDEX IF NOT EXISTS idx_refund_intents_order
  ON refund_execution_intents (order_id, created_at);

COMMENT ON TABLE refund_execution_intents IS
  'DURABLE refund intent authority before Stripe/PayPal; no PSP call in migration,'
  ' no automatic legacy refund backfill. Existing refunds MUST be reconciled before activation.';

COMMENT ON COLUMN refund_execution_intents.operation_key IS
  'Caller event id or explicitly authorized distinct partial refund event; replay keeps same key.';
