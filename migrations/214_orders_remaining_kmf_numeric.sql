-- @migration 214_orders_remaining_kmf_numeric.sql
-- @domain    orders
-- @purpose   Chantier currency debt (audit 09-2026), LOT 1b — les 10 colonnes
--            monétaires restantes d'orders : integer -> numeric(14,2).
--            Suite de la migration 213 (total_kmf), même patron, même
--            précision.
--
--            cost_transport_kmf, cost_douane_kmf, cost_estimated_kmf,
--            cost_real_kmf, discount_kmf, unsold_price_kmf, wallet_applied_kmf,
--            prepaid_amount_kmf, remaining_cash_kmf, transport_price_kmf.
--
--            Périmètre nettement plus restreint que total_kmf (93 fichiers) :
--            2 à 11 fichiers par colonne, aucune Number.isInteger()/opérateur
--            bitwise/modulo trouvé dessus, aucun CHECK constraint direct.
--            Le parseur NUMERIC installé dans db.js (migration précédente,
--            fondation du chantier) couvre déjà le risque de contrat de type
--            JS pour ces 10 colonnes comme pour total_kmf.
--
--            v_order_margins dépend de cost_estimated_kmf ET cost_real_kmf
--            (trouvé par exécution réelle — pg_depend) : elle est donc
--            recréée UNE SECONDE FOIS ici, à l'identique de la migration 213
--            (qui l'avait déjà recréée pour total_kmf/cost_estimated_kmf/
--            cost_real_kmf, mais Postgres bloque un ALTER TYPE sur une
--            colonne qu'une vue référence, quelle que soit la vue déjà
--            recréée par ailleurs).
--
--            compute_real_margin() (trigger BEFORE UPDATE) lit cost_real_kmf
--            et cost_estimated_kmf, déjà castés explicitement en ::NUMERIC
--            dans ses deux expressions — aucune modification nécessaire,
--            vérifié par exécution réelle (tests e2e-api).
--
--            trg_compute_real_margin est un trigger défini spécifiquement
--            "BEFORE UPDATE OF cost_real_kmf" (trouvé par exécution réelle —
--            pg_trigger — pas par lecture du dump, qui ne montre que le CORPS
--            de la fonction, jamais la clause UPDATE OF qui la déclenche).
--            Postgres bloque un ALTER TYPE sur une colonne référencée par la
--            DÉFINITION d'un trigger, indépendamment de son corps : le
--            trigger est donc supprimé puis recréé à l'identique, encadrant
--            l'ALTER TABLE.
--
--            Aucune autre fonction ni contrainte CHECK ne référence les 8
--            colonnes restantes (recherche exhaustive dans le dump canonique
--            avant écriture de cette migration).

DROP VIEW IF EXISTS v_order_margins;
DROP TRIGGER IF EXISTS trg_compute_real_margin ON orders;

ALTER TABLE orders
  ALTER COLUMN cost_transport_kmf TYPE NUMERIC(14,2),
  ALTER COLUMN cost_douane_kmf TYPE NUMERIC(14,2),
  ALTER COLUMN cost_estimated_kmf TYPE NUMERIC(14,2),
  ALTER COLUMN cost_real_kmf TYPE NUMERIC(14,2),
  ALTER COLUMN discount_kmf TYPE NUMERIC(14,2),
  ALTER COLUMN unsold_price_kmf TYPE NUMERIC(14,2),
  ALTER COLUMN wallet_applied_kmf TYPE NUMERIC(14,2),
  ALTER COLUMN prepaid_amount_kmf TYPE NUMERIC(14,2),
  ALTER COLUMN remaining_cash_kmf TYPE NUMERIC(14,2),
  ALTER COLUMN transport_price_kmf TYPE NUMERIC(14,2);

CREATE TRIGGER trg_compute_real_margin
  BEFORE UPDATE OF cost_real_kmf ON orders
  FOR EACH ROW EXECUTE FUNCTION compute_real_margin();

CREATE VIEW v_order_margins AS
 SELECT o.id,
    o.reference,
    (o.created_at)::date AS order_date,
    o.total_kmf,
    o.cost_estimated_kmf,
    o.cost_real_kmf,
    o.margin_estimated_pct,
    o.margin_real_pct,
    o.cost_delta_pct,
    o.margin_alert,
    o.sourcing_blocked,
    o.status,
    o.confection_type,
    o.cost_closed_at,
    p.full_name AS client_name,
    r.name AS relais_name
   FROM ((orders o
     LEFT JOIN users p ON ((p.id = o.user_id)))
     LEFT JOIN relais r ON ((r.id = o.relais_id)))
  WHERE (o.cost_real_kmf IS NOT NULL);
