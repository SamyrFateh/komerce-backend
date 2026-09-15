-- @migration 235_sourcing_pln_rate.sql
-- @domain economic-engine
-- @purpose Explicit sourcing PLN conversion. No guessed seed or fallback.
ALTER TABLE finance_config ADD COLUMN IF NOT EXISTS taux_pln_kmf NUMERIC(18,6)
  CHECK (taux_pln_kmf > 0);
COMMENT ON COLUMN finance_config.taux_pln_kmf IS
  'KMF per PLN, explicitly maintained in Finance sourcing configuration. NULL blocks PLN sourcing valuation; native provider amounts remain PLN.';
