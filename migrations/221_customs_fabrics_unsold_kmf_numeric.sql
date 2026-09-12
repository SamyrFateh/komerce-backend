-- @migration 221_customs_fabrics_unsold_kmf_numeric.sql
-- @domain    customs
-- @purpose   Chantier currency debt (audit 09-2026), LOT 8 — clôture du
--            reliquat convertible. Les 13 dernières colonnes monétaires
--            integer hors exchange_rates :
--
--              cart_shares.cart_total_kmf
--              customs_history.customs_estimated_kmf/customs_real_kmf/
--                              customs_delta_kmf
--              disputes.refund_kmf
--              fabrics.price_per_meter_kmf/price_per_yard_kmf
--              shipments.customs_total_estimated_kmf/customs_total_real_kmf
--              unsold_items.original_price_kmf/resolved_price_kmf/
--                           unsold_price_kmf
--              finance_config.hub_monthly_cost_aed
--
--            Faible exposition code (0 à 4 fichiers chacune) : ce lot est un
--            nettoyage, pas un chantier à risque. disputes.refund_kmf est le
--            plus sensible — c'est un montant réellement remboursé à un
--            client, au même titre que refunds.amount_kmf converti au LOT 7.
--
--            Précision NUMERIC(14,2), alignée sur les lots précédents.
--
--            NE COUVRE PAS exchange_rates.aed_kmf / eur_kmf, maintenues hors
--            périmètre depuis l'audit : ce sont des TAUX de conversion, pas
--            des montants. Un taux en integer est un problème distinct et
--            conceptuellement plus grave (il fausse toute conversion, pas
--            une seule ligne), qui mérite son propre chantier avec sa propre
--            décision de précision. L'absorber dans un lot de nettoyage
--            serait le traiter à la légère.
--
--            Quatre vues dépendent de ces colonnes et bloquent l'ALTER TYPE
--            (trouvées par pg_depend sur base réellement migrée) :
--            customs_taux_actuel, customs_taux_mensuel, v_customs_analysis,
--            v_unsold_pipeline. Recréées à l'identique d'après
--            pg_get_viewdef(). Aucune cascade vue-sur-vue (vérifié).
--
--            trg_customs_anomaly est un trigger BEFORE INSERT OR UPDATE OF
--            customs_real_kmf — column-specific, donc bloquant pour l'ALTER
--            TYPE (même piège qu'au LOT 1b avec trg_compute_real_margin).
--            Supprimé puis recréé à l'identique.

DROP VIEW IF EXISTS customs_taux_actuel;
DROP VIEW IF EXISTS customs_taux_mensuel;
DROP VIEW IF EXISTS v_customs_analysis;
DROP VIEW IF EXISTS v_unsold_pipeline;
DROP TRIGGER IF EXISTS trg_customs_anomaly ON customs_history;

ALTER TABLE cart_shares     ALTER COLUMN cart_total_kmf TYPE NUMERIC(14,2);
ALTER TABLE disputes        ALTER COLUMN refund_kmf TYPE NUMERIC(14,2);
ALTER TABLE fabrics
  ALTER COLUMN price_per_meter_kmf TYPE NUMERIC(14,2),
  ALTER COLUMN price_per_yard_kmf TYPE NUMERIC(14,2);
-- customs_delta_kmf est une COLONNE GÉNÉRÉE
-- (customs_real_kmf - customs_estimated_kmf) : Postgres refuse d'altérer le
-- type d'une colonne dont dépend une generated column, et le type d'une
-- generated column ne s'altère pas davantage. Elle est donc supprimée puis
-- recréée après conversion de ses deux sources — trouvé par exécution réelle,
-- ni pg_depend ni pg_trigger ne signalent ce cas.
-- DEUX colonnes générées dépendent de ces sources : customs_delta_kmf et
-- customs_delta_pct. La seconde n'a été révélée qu'en réexécutant après avoir
-- traité la première — l'erreur Postgres ne nomme qu'un bloqueur à la fois.
ALTER TABLE customs_history DROP COLUMN customs_delta_kmf;
ALTER TABLE customs_history DROP COLUMN customs_delta_pct;
ALTER TABLE customs_history
  ALTER COLUMN customs_estimated_kmf TYPE NUMERIC(14,2),
  ALTER COLUMN customs_real_kmf TYPE NUMERIC(14,2);
ALTER TABLE customs_history
  ADD COLUMN customs_delta_kmf NUMERIC(14,2)
  GENERATED ALWAYS AS (customs_real_kmf - customs_estimated_kmf) STORED;
-- customs_delta_pct recréée à l'identique de sa définition d'origine, y
-- compris les casts ::numeric devenus redondants après conversion (conservés
-- pour rester fidèle au dump canonique).
ALTER TABLE customs_history
  ADD COLUMN customs_delta_pct NUMERIC
  GENERATED ALWAYS AS (
    CASE
      WHEN (customs_estimated_kmf > 0) THEN round((((customs_real_kmf)::numeric / (customs_estimated_kmf)::numeric) - (1)::numeric) * (100)::numeric, 4)
      ELSE NULL::numeric
    END
  ) STORED;
ALTER TABLE shipments
  ALTER COLUMN customs_total_estimated_kmf TYPE NUMERIC(14,2),
  ALTER COLUMN customs_total_real_kmf TYPE NUMERIC(14,2);
ALTER TABLE unsold_items
  ALTER COLUMN original_price_kmf TYPE NUMERIC(14,2),
  ALTER COLUMN resolved_price_kmf TYPE NUMERIC(14,2),
  ALTER COLUMN unsold_price_kmf TYPE NUMERIC(14,2);
ALTER TABLE finance_config  ALTER COLUMN hub_monthly_cost_aed TYPE NUMERIC(14,2);

CREATE TRIGGER trg_customs_anomaly
  BEFORE INSERT OR UPDATE OF customs_real_kmf ON customs_history
  FOR EACH ROW EXECUTE FUNCTION flag_customs_anomaly();

CREATE VIEW customs_taux_actuel AS
SELECT COALESCE(taux_effectif_pct, round(COALESCE(droits_payes_kmf, customs_real_kmf::numeric, 0::numeric) / NULLIF(COALESCE(valeur_cif_kmf, customs_estimated_kmf::numeric), 0::numeric) * 100::numeric, 2)) AS taux_effectif_pct,
    customs_date AS date_dedouanement,
    sh_category AS categorie_declaree,
    nb_colis,
    COALESCE(valeur_cif_kmf, customs_estimated_kmf::numeric) AS valeur_cif_kmf,
    COALESCE(droits_payes_kmf, customs_real_kmf::numeric) AS droits_payes_kmf,
    customs_notes AS notes
   FROM customs_history
  WHERE COALESCE(statut, 'validated'::text) = 'validated'::text AND customs_date IS NOT NULL AND COALESCE(droits_payes_kmf, customs_real_kmf::numeric) IS NOT NULL
  ORDER BY customs_date DESC
 LIMIT 1;

CREATE VIEW customs_taux_mensuel AS
SELECT to_char(created_at, 'YYYY-MM'::text) AS mois,
    round(avg(customs_delta_pct), 2) AS taux_effectif_pct
   FROM customs_history
  WHERE customs_real_kmf > 0
  GROUP BY (to_char(created_at, 'YYYY-MM'::text));

CREATE VIEW v_customs_analysis AS
SELECT sh_category,
    product_category,
    count(*) AS nb_passages,
    avg(customs_delta_pct)::numeric(6,2) AS avg_delta_pct,
    max(customs_delta_pct)::numeric(6,2) AS max_delta_pct,
    count(*) FILTER (WHERE is_anomaly) AS nb_anomalies,
    round(1::numeric + COALESCE(avg(customs_delta_pct) / 100::numeric, 0.20) + 0.05, 3) AS recommended_coeff,
    max(customs_date) AS last_passage
   FROM customs_history
  WHERE customs_real_kmf IS NOT NULL
  GROUP BY sh_category, product_category
  ORDER BY (avg(customs_delta_pct)::numeric(6,2)) DESC NULLS LAST;

CREATE VIEW v_unsold_pipeline AS
SELECT ui.id,
    ui.product_name,
    ui.original_price_kmf,
    ui.unsold_price_kmf,
    round((1::numeric - ui.unsold_price_kmf::numeric / NULLIF(ui.original_price_kmf, 0)::numeric) * 100::numeric) AS remise_pct,
    ui.channel,
    ui.status,
    ui.unsold_at,
    EXTRACT(epoch FROM now() - ui.unsold_at) / 86400::numeric AS jours_en_stock,
    o.reference AS order_ref,
    u.full_name AS client_name,
    u.phone AS client_phone
   FROM unsold_items ui
     JOIN orders o ON o.id = ui.order_id
     JOIN users u ON u.id = o.user_id
  WHERE ui.status::text = 'available'::text
  ORDER BY ui.unsold_at;

