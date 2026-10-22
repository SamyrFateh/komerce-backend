-- @migration 312_fx_chain_hardening.sql
-- @domain    market
-- @purpose   Conditions Opus (GO sous conditions, lot 4) sur la chaîne FX DJF :
--            1. identités normalisées lower(btrim()) à l'insertion/approbation (alice ≠ ' Alice ' impossible à contourner) ;
--            2. bande de plausibilité sur fx_pegs (DJF pour 1 USD) comme sur les observations ;
--            3. TRUNCATE interdit sur les deux tables append-only.
--            Rollback : DROP TRIGGER fx_*_no_truncate ; ALTER TABLE fx_pegs DROP CONSTRAINT fx_peg_rate_band ;
--            restaurer fx_insert_guard / fx_append_only_guard de la migration 311.

ALTER TABLE fx_pegs DROP CONSTRAINT IF EXISTS fx_peg_rate_band;
ALTER TABLE fx_pegs ADD CONSTRAINT fx_peg_rate_band CHECK (rate >= 100 AND rate <= 300);

CREATE OR REPLACE FUNCTION fx_insert_guard() RETURNS trigger AS $$
BEGIN
  NEW.created_at := now();
  IF TG_TABLE_NAME = 'fx_rate_observations' THEN
    NEW.entered_by := lower(btrim(NEW.entered_by));
    IF NEW.entered_by = '' THEN
      RAISE EXCEPTION 'fx_rate_observations : entered_by vide';
    END IF;
    IF NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL THEN
      RAISE EXCEPTION 'fx_rate_observations : une observation est insérée non approuvée (approbation = étape séparée)';
    END IF;
    IF NEW.as_of > NEW.created_at THEN
      RAISE EXCEPTION 'fx_rate_observations : as_of dans le futur';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fx_append_only_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% est append-only : suppression interdite', TG_TABLE_NAME;
  END IF;
  IF TG_TABLE_NAME = 'fx_rate_observations' THEN
    IF OLD.approved_by IS NULL AND NEW.approved_by IS NOT NULL
       AND (NEW.id, NEW.base_ccy, NEW.quote_ccy, NEW.rate, NEW.source_label, NEW.source_ref, NEW.as_of, NEW.entered_by, NEW.created_at)
           IS NOT DISTINCT FROM
           (OLD.id, OLD.base_ccy, OLD.quote_ccy, OLD.rate, OLD.source_label, OLD.source_ref, OLD.as_of, OLD.entered_by, OLD.created_at) THEN
      NEW.approved_by := lower(btrim(NEW.approved_by));
      NEW.approved_at := now();
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION '% est append-only : modification interdite', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fx_no_truncate_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% est append-only : TRUNCATE interdit', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fx_rate_observations_no_truncate ON fx_rate_observations;
CREATE TRIGGER fx_rate_observations_no_truncate BEFORE TRUNCATE ON fx_rate_observations
  FOR EACH STATEMENT EXECUTE FUNCTION fx_no_truncate_guard();
DROP TRIGGER IF EXISTS fx_pegs_no_truncate ON fx_pegs;
CREATE TRIGGER fx_pegs_no_truncate BEFORE TRUNCATE ON fx_pegs
  FOR EACH STATEMENT EXECUTE FUNCTION fx_no_truncate_guard();
