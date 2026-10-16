-- @migration 298_customs_effective_rates_observed_only.sql
-- @domain    customs / economic-engine
-- @purpose   Taux douane effectif = taux OBSERVÉ uniquement (DOUANE-2C).
--
-- Défaut prouvé : la vue 034 additionnait customs_paid_kmf avec COALESCE(...,0) tout en gardant la
-- valeur CIF des envois dont les droits sont INCONNUS (NULL) au dénominateur : un inconnu comptait
-- comme un zéro et tirait le taux vers le bas (consommateurs : dashboard-ops-queries.js projection
-- terrain, GET /api/admin/customs-shipments/rates).
-- Correction : numérateur et dénominateur ne portent que les envois actifs dont les droits sont
-- renseignés (NULL = inconnu exclu ; 0 = zéro confirmé inclus). Sans observation, rate_pct = NULL
-- (et non 0 : « aucune observation » n'est pas « 0 % constaté »). Un taux observé reste une
-- ESTIMATION de projection : il n'écrit jamais un coût réel ni une imputation figée.
-- Colonnes existantes inchangées (nom, ordre, type) ; nb_observed / nb_unknown ajoutées en fin.
-- Aucun backfill, aucune donnée modifiée. Rollback : rejouer la définition de la vue de 034.

DO $pre$
BEGIN
  IF to_regclass('public.customs_shipments') IS NULL THEN
    RAISE EXCEPTION '298 precondition: customs_shipments requise';
  END IF;
END
$pre$;

CREATE OR REPLACE VIEW public.customs_effective_rates AS
SELECT
  p.period,
  COUNT(s.id)                                                               AS nb_shipments,
  COALESCE(SUM(s.cif_value_kmf) FILTER (WHERE s.customs_paid_kmf IS NOT NULL), 0) AS total_cif_kmf,
  COALESCE(SUM(s.customs_paid_kmf), 0)                                      AS total_customs_kmf,
  CASE WHEN COALESCE(SUM(s.cif_value_kmf) FILTER (WHERE s.customs_paid_kmf IS NOT NULL), 0) > 0
       THEN ROUND((SUM(s.customs_paid_kmf)
                   / SUM(s.cif_value_kmf) FILTER (WHERE s.customs_paid_kmf IS NOT NULL) * 100)::numeric, 2)
       ELSE NULL END                                                        AS rate_pct,
  COUNT(s.id) FILTER (WHERE s.customs_paid_kmf IS NOT NULL)                  AS nb_observed,
  COUNT(s.id) FILTER (WHERE s.customs_paid_kmf IS NULL)                    AS nb_unknown
FROM (VALUES ('last_30d', 30), ('last_90d', 90), ('last_365d', 365)) AS p(period, days)
LEFT JOIN public.customs_shipments s
  ON s.is_active = TRUE AND s.shipment_date >= CURRENT_DATE - (p.days * INTERVAL '1 day')
GROUP BY p.period;
