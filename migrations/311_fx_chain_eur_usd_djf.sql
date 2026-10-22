-- @migration 311_fx_chain_eur_usd_djf.sql
-- @domain    market
-- @purpose   Chaîne de change EUR→USD→DJF (DJF indexé sur l'USD). Décision Opus GO sous conditions (lot 4).
--            Magasin SÉPARÉ de currency_parities (qui reste réservée aux parités fixes vers EUR, freeze 22-08-2026,
--            invariants 4/5/9). Aucun taux EUR/USD pré-rempli : sans observation approuvée, fraîche et antérieure
--            à la transaction, toute conversion DJF est refusée (fail-closed).
--            - fx_rate_observations : EUR→USD flottant, saisi + approuvé par deux personnes différentes, append-only.
--            - fx_pegs              : seul peg admis USD→DJF, daté, append-only.
--            Rollback : DROP TABLE fx_pegs, fx_rate_observations (aucune donnée métier ne les référence encore).

CREATE TABLE IF NOT EXISTS fx_rate_observations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_ccy     TEXT NOT NULL DEFAULT 'EUR' CHECK (base_ccy = 'EUR'),
  quote_ccy    TEXT NOT NULL DEFAULT 'USD' CHECK (quote_ccy = 'USD'),
  rate         NUMERIC(18, 8) NOT NULL CHECK (rate >= 0.8 AND rate <= 1.6), -- USD pour 1 EUR (bande de plausibilité)
  source_label TEXT NOT NULL CHECK (length(btrim(source_label)) > 0),
  source_ref   TEXT,
  as_of        TIMESTAMPTZ NOT NULL,
  entered_by   TEXT NOT NULL CHECK (length(btrim(entered_by)) > 0),
  approved_by  TEXT,
  approved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fx_obs_as_of_not_future CHECK (as_of <= created_at),
  CONSTRAINT fx_obs_two_person CHECK (approved_by IS NULL OR approved_by <> entered_by),
  CONSTRAINT fx_obs_approval_pair CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  CONSTRAINT fx_obs_unique_as_of UNIQUE (as_of)
);

CREATE TABLE IF NOT EXISTS fx_pegs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_ccy     TEXT NOT NULL DEFAULT 'USD' CHECK (base_ccy = 'USD'),
  quote_ccy    TEXT NOT NULL DEFAULT 'DJF' CHECK (quote_ccy = 'DJF'),
  rate         NUMERIC(18, 8) NOT NULL CHECK (rate > 0), -- DJF pour 1 USD
  source_label TEXT NOT NULL CHECK (length(btrim(source_label)) > 0),
  source_ref   TEXT,
  valid_from   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fx_peg_unique_valid_from UNIQUE (valid_from)
);

CREATE OR REPLACE FUNCTION fx_append_only_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% est append-only : suppression interdite', TG_TABLE_NAME;
  END IF;
  -- Seule exception : approuver une observation non encore approuvée (approved_by/approved_at uniquement).
  IF TG_TABLE_NAME = 'fx_rate_observations' THEN
    IF OLD.approved_by IS NULL AND NEW.approved_by IS NOT NULL
       AND (NEW.id, NEW.base_ccy, NEW.quote_ccy, NEW.rate, NEW.source_label, NEW.source_ref, NEW.as_of, NEW.entered_by, NEW.created_at)
           IS NOT DISTINCT FROM
           (OLD.id, OLD.base_ccy, OLD.quote_ccy, OLD.rate, OLD.source_label, OLD.source_ref, OLD.as_of, OLD.entered_by, OLD.created_at) THEN
      NEW.approved_at := now();
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION '% est append-only : modification interdite', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

-- À l'insertion : horodatage imposé par la base (jamais antidatable) ; une observation naît NON approuvée.
CREATE OR REPLACE FUNCTION fx_insert_guard() RETURNS trigger AS $$
BEGIN
  NEW.created_at := now();
  IF TG_TABLE_NAME = 'fx_rate_observations' THEN
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

DROP TRIGGER IF EXISTS fx_rate_observations_insert_guard ON fx_rate_observations;
CREATE TRIGGER fx_rate_observations_insert_guard BEFORE INSERT ON fx_rate_observations
  FOR EACH ROW EXECUTE FUNCTION fx_insert_guard();
DROP TRIGGER IF EXISTS fx_pegs_insert_guard ON fx_pegs;
CREATE TRIGGER fx_pegs_insert_guard BEFORE INSERT ON fx_pegs
  FOR EACH ROW EXECUTE FUNCTION fx_insert_guard();

DROP TRIGGER IF EXISTS fx_rate_observations_append_only ON fx_rate_observations;
CREATE TRIGGER fx_rate_observations_append_only BEFORE UPDATE OR DELETE ON fx_rate_observations
  FOR EACH ROW EXECUTE FUNCTION fx_append_only_guard();
DROP TRIGGER IF EXISTS fx_pegs_append_only ON fx_pegs;
CREATE TRIGGER fx_pegs_append_only BEFORE UPDATE OR DELETE ON fx_pegs
  FOR EACH ROW EXECUTE FUNCTION fx_append_only_guard();

COMMENT ON TABLE fx_rate_observations IS
  'EUR→USD flottant sourcé, daté, approuvé par une 2e personne. Aucune valeur pré-remplie. Distinct de currency_parities.';
COMMENT ON TABLE fx_pegs IS
  'Seul peg admis : USD→DJF (Banque centrale de Djibouti). Append-only, daté (valid_from).';

INSERT INTO fx_pegs (rate, source_label, source_ref, valid_from)
SELECT 177.721, 'Banque centrale de Djibouti — parité officielle 177,721 DJF pour 1 USD',
       'https://en.wikipedia.org/wiki/Djiboutian_franc', TIMESTAMP WITH TIME ZONE '2000-01-01 00:00:00+00'
WHERE NOT EXISTS (SELECT 1 FROM fx_pegs);
