-- @migration 216_wallet_cash_kmf_numeric.sql
-- @domain    wallet
-- @purpose   Chantier currency debt (audit 09-2026), LOT 3 — les 9 colonnes
--            monétaires integer du grand livre wallet/cash, en 5 tables :
--
--              wallets.balance_kmf
--              wallet_transactions.amount_kmf, balance_after_kmf
--              wallet_credit_lots.original_amount_kmf, remaining_kmf
--              wallet_consumptions.amount_kmf
--              cash_reconciliation.expected_kmf, declared_kmf, deposited_kmf
--
--            Précision numeric(14,2), cohérente avec market_settlements et
--            orders (chantiers précédents de ce même travail).
--
--            Aucun trigger, aucune vue ne dépend de ces colonnes (vérifié par
--            exécution réelle — pg_depend, pg_trigger sur les 5 tables). Lot
--            structurellement plus simple que orders/products sur ce plan.
--
--            Risque différent et propre à ce lot, non présent sur les
--            précédents : services/wallet-service.js consomme les lots de
--            crédit en FIFO par SOUSTRACTION RÉPÉTÉE sur un solde
--            (remaining -= consume, à travers plusieurs lots). Avec des
--            integer, cette classe de dérive n'existe pas ; avec des
--            décimales réelles, une soustraction flottante JS peut laisser
--            un résidu de l'ordre de 1e-13 au lieu d'exactement zéro. Testé
--            explicitement (tests/e2e-api/wallet.kmf-numeric.e2e.test.js) en
--            poussant la boucle à plusieurs lots avec des montants choisis
--            pour maximiser le risque de dérive — pas seulement en vérifiant
--            que la conversion de type réussit.
--
--            Contraintes CHECK inchangées, valables identiquement pour
--            integer et numeric : chk_balance_non_negative (>= 0),
--            wallet_transactions_amount_kmf_check (> 0),
--            wallet_credit_lots_remaining_kmf_check (>= 0),
--            wallet_consumptions_amount_kmf_check (> 0).

ALTER TABLE wallets
  ALTER COLUMN balance_kmf TYPE NUMERIC(14,2);

ALTER TABLE wallet_transactions
  ALTER COLUMN amount_kmf TYPE NUMERIC(14,2),
  ALTER COLUMN balance_after_kmf TYPE NUMERIC(14,2);

ALTER TABLE wallet_credit_lots
  ALTER COLUMN original_amount_kmf TYPE NUMERIC(14,2),
  ALTER COLUMN remaining_kmf TYPE NUMERIC(14,2);

ALTER TABLE wallet_consumptions
  ALTER COLUMN amount_kmf TYPE NUMERIC(14,2);

ALTER TABLE cash_reconciliation
  ALTER COLUMN expected_kmf TYPE NUMERIC(14,2),
  ALTER COLUMN declared_kmf TYPE NUMERIC(14,2),
  ALTER COLUMN deposited_kmf TYPE NUMERIC(14,2);
