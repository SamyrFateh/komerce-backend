-- @migration 456_supplier_settlement_native_debit.sql
-- @domain purchasing / finance
-- @purpose Preserve actual debit and fee currency with immutable historical FX projection; legacy facts untouched.
ALTER TABLE supplier_payment_settlements
 ADD COLUMN debit_amount numeric(18,4),
 ADD COLUMN debit_currency text,
 ADD COLUMN fee_amount numeric(18,4),
 ADD COLUMN fee_currency text,
 ADD COLUMN debit_at timestamptz,
 ADD COLUMN debit_fx_snapshot jsonb,
 ADD CONSTRAINT chk_sps_native_debit_complete CHECK (
   (debit_amount IS NULL AND debit_currency IS NULL AND fee_amount IS NULL AND fee_currency IS NULL AND debit_at IS NULL AND debit_fx_snapshot IS NULL)
   OR (debit_amount IS NOT NULL AND debit_amount>0 AND debit_currency IS NOT NULL AND debit_currency ~ '^[A-Z]{3}$'
   AND fee_amount IS NOT NULL AND fee_amount>=0 AND (kind='payment' OR fee_amount=0)
   AND fee_currency IS NOT NULL AND fee_currency ~ '^[A-Z]{3}$' AND debit_at IS NOT NULL
   AND debit_fx_snapshot IS NOT NULL AND jsonb_typeof(debit_fx_snapshot)='object')
 );
COMMENT ON COLUMN supplier_payment_settlements.amount_kmf IS 'Legacy: actual recorded KMF. For native debit: historical FX KMF projection, never a new bank debit fact.';
COMMENT ON COLUMN supplier_payment_settlements.debit_currency IS 'Actual bank/wallet currency, distinct from supplier obligation currency.';
