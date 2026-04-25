-- ============================================================
-- Migration 046 : Audit du levier de scenario dans price_history
-- Date : avril 2026
--
-- DOCTRINE V3 : a chaque application de prix, on enregistre quel
-- scenario a ete choisi par l'humain (honnete, sous-couverture,
-- promo volume, loading, projection) et avec quels parametres.
-- ============================================================

SET client_encoding = 'UTF8';

-- price_history existe deja (creee migration anterieure)
-- On ajoute des colonnes optionnelles pour traçabilite scenario

ALTER TABLE price_history
  ADD COLUMN IF NOT EXISTS scenario_id TEXT;

ALTER TABLE price_history
  ADD COLUMN IF NOT EXISTS scenario_label TEXT;

ALTER TABLE price_history
  ADD COLUMN IF NOT EXISTS levier TEXT;
  -- Valeurs : null (par defaut), 'undercoverage', 'volume_discount',
  -- 'cost_loading', 'projection'

CREATE INDEX IF NOT EXISTS idx_price_history_scenario
  ON price_history(scenario_id) WHERE scenario_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_price_history_levier
  ON price_history(levier) WHERE levier IS NOT NULL;

DO $$
BEGIN
  RAISE NOTICE 'Migration 046 OK : audit scenario dans price_history';
  RAISE NOTICE '  Nouvelles colonnes : scenario_id, scenario_label, levier';
END $$;
