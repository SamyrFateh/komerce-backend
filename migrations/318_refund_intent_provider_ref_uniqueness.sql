-- @migration 318_refund_intent_provider_ref_uniqueness.sql
-- @domain refunds
-- @purpose Prevent one real Stripe/PayPal refund reference from settling two ledger intentions.
-- Additive unique guard. Existing duplicates cause migration failure; NEVER delete or silently merge them.
-- No PSP calls, no backfill, no RESET.
CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_intents_provider_ref
  ON refund_execution_intents (provider, provider_ref)
  WHERE provider_ref IS NOT NULL;

COMMENT ON INDEX uq_refund_intents_provider_ref IS
  'One external provider refund operation must settle at most one Komerce intent';
