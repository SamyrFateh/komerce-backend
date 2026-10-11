-- 286_cash_deposit_declared_currency.sql
--
-- Dépôt relais : conserver le montant et la devise réellement déclarés.
--
-- Constat : cash_deposits.amount_kmf est saisi librement en KMF alors que les
-- relais du Cameroun manipulent des XAF. Sans montant d'origine ni parité
-- figée, un dépôt XAF saisi « comme du KMF » fausse le rapprochement.
--
-- Additif et rétro-compatible :
--   - amount_kmf reste la valeur canonique KMF (base économique inchangée) ;
--   - 4 colonnes NULLABLES suivant le patron snapshot de la migration 166
--     (montant d'origine, devise, taux vers KMF, source du taux) ;
--   - lignes historiques : tout NULL = saisie historique directement en KMF,
--     aucun backfill, aucune valeur inventée ;
--   - CHECK « tout ou rien » + KMF => taux 1 (jamais de taux libre pour KMF).
-- Le taux est calculé par le service via utils/currency.js (currency_parities),
-- jamais saisi par l'utilisateur.

ALTER TABLE cash_deposits
  ADD COLUMN IF NOT EXISTS declared_amount NUMERIC(18,2) NULL,
  ADD COLUMN IF NOT EXISTS declared_currency TEXT NULL,
  ADD COLUMN IF NOT EXISTS fx_rate_to_kmf NUMERIC(18,6) NULL,
  ADD COLUMN IF NOT EXISTS fx_source TEXT NULL;

ALTER TABLE cash_deposits
  ADD CONSTRAINT cash_deposits_declared_snapshot_chk CHECK (
    (declared_amount IS NULL AND declared_currency IS NULL
      AND fx_rate_to_kmf IS NULL AND fx_source IS NULL)
    OR
    (declared_amount > 0
      AND declared_currency ~ '^[A-Z]{3}$'
      AND fx_rate_to_kmf > 0
      AND char_length(btrim(fx_source)) BETWEEN 2 AND 200
      AND (declared_currency <> 'KMF' OR fx_rate_to_kmf = 1))
  );

COMMENT ON COLUMN cash_deposits.declared_amount IS
  'Montant tel que déclaré par le relais, dans declared_currency. NULL = saisie historique en KMF (amount_kmf seul).';
COMMENT ON COLUMN cash_deposits.fx_rate_to_kmf IS
  'KMF pour 1 unité de declared_currency, figé à la déclaration depuis currency_parities (jamais saisi).';
