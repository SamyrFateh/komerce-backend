-- 316 — finance_config : les colonnes de taux ne sont plus une autorité FX (PR-D de l'unification monétaire)
--
-- L'autorité de conversion est services/fx-authority.js (pivot EUR) : currency_parities (parités fixes KMF/XAF),
-- fx_rate_observations (EUR/USD approuvé à deux personnes) et fx_pegs. Les colonnes taux_change_eur_kmf et
-- taux_aed_kmf de finance_config ne sont plus lues ni écrites par le code transactionnel : elles deviennent
-- optionnelles (plus de NOT NULL ni de valeur par défaut 138/492 qui fabriquait un taux) et marquées DEPRECATED.
-- Les paramètres économiques hébergés par finance_config (marges, coûts fixes, etc.) sont inchangés.
-- Le DROP des colonnes sera fait dans une PR séparée, après un cycle de déploiement sans lecture.
-- Rollback : ALTER COLUMN ... SET DEFAULT / SET NOT NULL (valeurs historiques inchangées).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'finance_config' AND column_name = 'taux_change_eur_kmf') THEN
    ALTER TABLE finance_config ALTER COLUMN taux_change_eur_kmf DROP NOT NULL;
    ALTER TABLE finance_config ALTER COLUMN taux_change_eur_kmf DROP DEFAULT;
    COMMENT ON COLUMN finance_config.taux_change_eur_kmf IS 'DEPRECATED (migration 316) : jamais lu ni écrit. Autorité = currency_parities (EUR/KMF) via services/fx-authority.js.';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'finance_config' AND column_name = 'taux_aed_kmf') THEN
    ALTER TABLE finance_config ALTER COLUMN taux_aed_kmf DROP NOT NULL;
    ALTER TABLE finance_config ALTER COLUMN taux_aed_kmf DROP DEFAULT;
    COMMENT ON COLUMN finance_config.taux_aed_kmf IS 'DEPRECATED (migration 316) : jamais lu ni écrit. AED = observation EUR/USD approuvée x peg USD/AED via services/fx-authority.js.';
  END IF;
END $$;
