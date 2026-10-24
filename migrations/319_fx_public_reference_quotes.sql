-- @migration 319_fx_public_reference_quotes.sql
-- @domain    market
-- @purpose   Source publique officielle EUR pivot, synchronisée automatiquement.
--            Les cotations de référence BCE sont enregistrées telles que publiées
--            (date de cotation, devise, taux, URL) sans fausse validation humaine.
--            Les parités fixes KMF/XAF restent exclusivement dans currency_parities.
--            Le snapshot transactionnel conserve l'identifiant de la cotation utilisée.
CREATE TABLE IF NOT EXISTS fx_public_reference_quotes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_ccy     TEXT NOT NULL DEFAULT 'EUR' CHECK (base_ccy = 'EUR'),
  quote_ccy    TEXT NOT NULL CHECK (quote_ccy ~ '^[A-Z]{3}$' AND quote_ccy NOT IN ('EUR', 'KMF', 'XAF')),
  rate         NUMERIC(24, 8) NOT NULL CHECK (rate > 0 AND rate < 100000000),
  as_of        DATE NOT NULL CHECK (as_of <= CURRENT_DATE),
  source_label TEXT NOT NULL DEFAULT 'Banque centrale européenne' CHECK (source_label = 'Banque centrale européenne'),
  source_ref   TEXT NOT NULL CHECK (source_ref = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'),
  ingested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fx_public_reference_quotes_unique UNIQUE (base_ccy, quote_ccy, as_of)
);
CREATE INDEX IF NOT EXISTS idx_fx_public_reference_quote_latest
  ON fx_public_reference_quotes (quote_ccy, as_of DESC);
-- Réutilise la garde append-only déjà établie par la migration 311 :
-- jamais de réécriture rétroactive des cours publiés, même en cas de révision.
DROP TRIGGER IF EXISTS fx_public_reference_quotes_append_only ON fx_public_reference_quotes;
CREATE TRIGGER fx_public_reference_quotes_append_only
  BEFORE UPDATE OR DELETE ON fx_public_reference_quotes
  FOR EACH ROW EXECUTE FUNCTION fx_append_only_guard();
DROP TRIGGER IF EXISTS fx_public_reference_quotes_no_truncate ON fx_public_reference_quotes;
CREATE TRIGGER fx_public_reference_quotes_no_truncate
  BEFORE TRUNCATE ON fx_public_reference_quotes
  FOR EACH STATEMENT EXECUTE FUNCTION fx_no_truncate_guard();
COMMENT ON TABLE fx_public_reference_quotes IS
  'Cotations EUR/XXX BCE datées, sourcées, ingérées automatiquement et immuables. Source publique distincte des observations manuelles à double approbation.';
