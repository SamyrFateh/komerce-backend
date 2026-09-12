-- @migration 220_refunds_credits_cash_kmf_numeric.sql
-- @domain    refunds
-- @purpose   Chantier currency debt (audit 09-2026), LOT 7 — les 4 colonnes
--            de FLUX FINANCIER restées integer, les plus exposées du
--            reliquat après le LOT 6 (43 fichiers chacune) :
--
--              refunds.amount_kmf           (montant remboursé au client)
--              store_credits.amount_kmf     (avoir émis)
--              store_credits.remaining_kmf  (solde restant de l'avoir)
--              cash_collections.amount_kmf  (encaissement terrain)
--              cash_deposits.amount_kmf     (dépôt terrain)
--
--            Ce sont des montants réellement remis ou dus à une personne :
--            un remboursement, un avoir, de l'argent liquide compté. Les
--            arrondir à l'unité sur un marché à décimales fait perdre des
--            centimes à quelqu'un, à chaque opération.
--
--            Précision NUMERIC(14,2), alignée sur orders.total_kmf
--            (migration 213) et wallets.balance_kmf (216) — ce sont des
--            montants de transaction de même nature.
--
--            Aucune vue, aucun trigger, aucune contrainte CHECK ne dépend de
--            ces colonnes (vérifié par pg_depend / pg_trigger / pg_constraint
--            sur une base réellement migrée, pas par lecture du dump
--            canonique, qui retarde sur les migrations mergées). Lot
--            structurellement le plus simple du chantier sur ce plan : aucun
--            objet à recréer.
--
--            store_credits.remaining_kmf est converti EN MÊME TEMPS que
--            store_credits.amount_kmf délibérément : un avoir dont le montant
--            porte des centimes mais dont le solde restant ne peut pas les
--            représenter produirait un résidu non consommable à chaque usage
--            partiel — exactement le défaut total/lignes corrigé au LOT 6.

ALTER TABLE refunds
  ALTER COLUMN amount_kmf TYPE NUMERIC(14,2);

ALTER TABLE store_credits
  ALTER COLUMN amount_kmf TYPE NUMERIC(14,2),
  ALTER COLUMN remaining_kmf TYPE NUMERIC(14,2);

ALTER TABLE cash_collections
  ALTER COLUMN amount_kmf TYPE NUMERIC(14,2);

ALTER TABLE cash_deposits
  ALTER COLUMN amount_kmf TYPE NUMERIC(14,2);
