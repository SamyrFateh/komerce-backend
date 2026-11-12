-- @migration 409_sav_compensation_refund_intent.sql
-- @domain orders,refunds
-- @purpose Link the immutable SAV decision to the canonical refund intent.
-- A decision owns one durable intent. Its settlement status is read from the ledger.
ALTER TABLE public.relay_return_compensations
  ADD COLUMN refund_intent_id uuid UNIQUE REFERENCES public.refund_execution_intents(id),
  ADD COLUMN refund_amount_kmf numeric(18,2),
  ADD CONSTRAINT chk_return_compensation_ledger_ref
    CHECK (
      (movement = 'ledger_refund' AND refund_intent_id IS NOT NULL
       AND refund_amount_kmf IS NOT NULL AND refund_amount_kmf > 0)
      OR (movement <> 'ledger_refund' AND refund_intent_id IS NULL AND refund_amount_kmf IS NULL)
    );
