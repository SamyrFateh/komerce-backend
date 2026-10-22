-- @migration 314_fx_authority_foundation.sql
-- @domain    market
-- @purpose   Fondation de l'autorité de conversion unique (EUR pivot), décision propriétaire + validation Opus :
--            1. currency_parities devient immuable en valeur (UPDATE de eur_rate/currency interdit, TRUNCATE interdit) ;
--               un changement de parité = nouvelle décision gouvernée, jamais une retouche silencieuse.
--            2. fx_pegs accepte un 2e peg officiel, USD→AED (3,6725, CBUAE), avec bande par paire et
--               unicité (devise, valid_from). Aucun autre peg n'est admis ; CNY et autres : refus applicatif.
--            Rollback : DROP TRIGGER currency_parities_value_guard/currency_parities_no_truncate ; restaurer les CHECK/UNIQUE de 311/312.

-- 1. currency_parities : valeur immuable
CREATE OR REPLACE FUNCTION currency_parities_value_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.currency IS DISTINCT FROM OLD.currency OR NEW.eur_rate IS DISTINCT FROM OLD.eur_rate THEN
    RAISE EXCEPTION 'currency_parities : parité immuable (une nouvelle parité est une décision gouvernée, pas un UPDATE)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS currency_parities_value_guard ON currency_parities;
CREATE TRIGGER currency_parities_value_guard BEFORE UPDATE ON currency_parities
  FOR EACH ROW EXECUTE FUNCTION currency_parities_value_guard();

CREATE OR REPLACE FUNCTION currency_parities_no_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'currency_parities : TRUNCATE interdit';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS currency_parities_no_truncate ON currency_parities;
CREATE TRIGGER currency_parities_no_truncate BEFORE TRUNCATE ON currency_parities
  FOR EACH STATEMENT EXECUTE FUNCTION currency_parities_no_truncate();

-- 2. fx_pegs : 2e peg (AED), bande par paire, unicité par devise
ALTER TABLE fx_pegs DROP CONSTRAINT IF EXISTS fx_pegs_quote_ccy_check;
ALTER TABLE fx_pegs ADD CONSTRAINT fx_pegs_quote_ccy_check CHECK (quote_ccy IN ('DJF', 'AED'));
ALTER TABLE fx_pegs DROP CONSTRAINT IF EXISTS fx_peg_rate_band;
ALTER TABLE fx_pegs ADD CONSTRAINT fx_peg_rate_band CHECK (
  (quote_ccy = 'DJF' AND rate >= 100 AND rate <= 300) OR
  (quote_ccy = 'AED' AND rate >= 3 AND rate <= 4.5)
);
ALTER TABLE fx_pegs DROP CONSTRAINT IF EXISTS fx_peg_unique_valid_from;
ALTER TABLE fx_pegs ADD CONSTRAINT fx_peg_unique_quote_valid_from UNIQUE (quote_ccy, valid_from);

INSERT INTO fx_pegs (quote_ccy, rate, source_label, source_ref, valid_from)
SELECT 'AED', 3.6725, 'Central Bank of the UAE — parité officielle 3,6725 AED pour 1 USD (depuis 1997)',
       'CBUAE — peg AED/USD', TIMESTAMP WITH TIME ZONE '2000-01-01 00:00:00+00'
WHERE NOT EXISTS (SELECT 1 FROM fx_pegs WHERE quote_ccy = 'AED');

COMMENT ON TABLE fx_pegs IS
  'Pegs officiels USD→devise (DJF Banque centrale de Djibouti ; AED Central Bank of the UAE). Append-only, datés.';
