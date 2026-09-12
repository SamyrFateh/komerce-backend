-- @migration 213_orders_total_kmf_numeric.sql
-- @domain    orders
-- @purpose   Chantier currency debt (audit 09-2026), LOT 1a — première
--            colonne convertie, orders.total_kmf : integer -> numeric(14,2).
--
--            orders.total_kmf est l'exemple le plus critique des 73 colonnes
--            monétaires en integer identifiées par l'audit : le montant total
--            d'une commande réelle, structurellement incapable de porter des
--            centimes tant qu'il reste en integer. Sur un marché en EUR
--            (Mayotte, déjà nommé dans DOCTRINE_AUTONOMIE_RESPONSABLE_PAYS
--            §4), chaque total perdrait ses centimes par troncature
--            silencieuse.
--
--            Base staging, aucune ligne à préserver — scripts/komerce-db-
--            reset.sh remet tout à zéro avant tout passage réel. Le risque de
--            cette conversion n'est donc jamais la donnée : c'est le CONTRAT
--            DE TYPE JS. node-postgres retourne un integer en JS `number`,
--            un numeric en JS `string` par défaut — 93 fichiers lisent
--            orders.total_kmf, et une bascule silencieuse de type casserait
--            toute arithmétique bare (`total_kmf + fee` devient une
--            concaténation de chaînes). Traité en amont, une fois pour tout
--            le chantier : db.js enregistre désormais un parseur NUMERIC qui
--            renvoie un `number`, jamais une `string` (voir db.js, FIX
--            2026-09, commit précédent). Cette migration n'a donc plus ce
--            risque à porter elle-même.
--
--            Précision NUMERIC(14,2) : cohérente avec order_item_cost_
--            imputations.sale_total_kmf (déjà numeric(12,2)) et
--            market_settlements.amount (numeric(24,6)) — headroom au-dessus
--            de ce qu'un total de commande peut atteindre.
--
--            Ne touche PAS le nom de la colonne ni n'ajoute de colonne
--            `currency` : ce lot corrige uniquement le TYPE. La colonne
--            currency partagée par les 11 colonnes monétaires d'orders est
--            une décision de modélisation distincte, à trancher pour la
--            table entière plutôt que colonne par colonne (cf. plan d'attaque
--            devise, LOT 2 — chemin acheteur). Convertir le type seul, sans
--            renommer, garde chaque colonne restante dans un état cohérent
--            entre deux lots.
--
--            La contrainte chk_orders_total (total_kmf >= 0) reste valide
--            sans modification : la comparaison >= 0 est identique pour
--            integer et numeric. Les fonctions PL/pgSQL auto_unsold() et
--            compute_real_margin(), qui lisent total_kmf pour calculer
--            unsold_price_kmf et margin_real_pct, ne nécessitent aucune
--            modification : Postgres promeut déjà integer -> numeric
--            implicitement dans ces expressions, et la valeur produite est
--            strictement identique — vérifié par exécution réelle (tests
--            e2e-api), pas seulement par lecture du code source.

--            Deux vues dépendent directement de orders.total_kmf et bloquent
--            un ALTER COLUMN TYPE tant qu'elles existent (Postgres : "cannot
--            alter type of a column used by a view or rule" — trouvé par
--            exécution réelle contre Postgres, pas par lecture du schéma) :
--            suppliers_stats et v_order_margins. Les deux sont recréées à
--            l'identique ci-dessous, à un ajustement près : le COALESCE de
--            suppliers_stats forçait explicitement (0)::bigint (cohérent
--            avec sum(integer) -> bigint) ; devient (0)::numeric pour rester
--            cohérent avec sum(numeric) -> numeric, sans changer la logique.

DROP VIEW IF EXISTS suppliers_stats;
DROP VIEW IF EXISTS v_order_margins;

ALTER TABLE orders
  ALTER COLUMN total_kmf TYPE NUMERIC(14,2);

CREATE VIEW suppliers_stats AS
 SELECT id AS partner_id,
    name,
    partner_type,
    COALESCE(( SELECT count(*) AS count
           FROM orders o
          WHERE ((o.supplier_id = p.id) AND (o.status <> ALL (ARRAY['cancelled'::order_status, 'refunded'::order_status])))), (0)::bigint) AS orders_count_30d,
    COALESCE(( SELECT sum(o.total_kmf) AS sum
           FROM orders o
          WHERE ((o.supplier_id = p.id) AND (o.status <> ALL (ARRAY['cancelled'::order_status, 'refunded'::order_status])) AND (o.created_at >= (now() - '30 days'::interval)))), (0)::numeric) AS orders_revenue_30d_kmf,
    COALESCE(( SELECT avg(o.margin_real_pct) AS avg
           FROM orders o
          WHERE ((o.supplier_id = p.id) AND (o.margin_real_pct IS NOT NULL) AND (o.created_at >= (now() - '90 days'::interval)))), (0)::numeric) AS avg_margin_pct_90d,
    COALESCE(( SELECT count(*) AS count
           FROM customs_shipments cs
          WHERE ((cs.supplier_id = p.id) AND (cs.is_active = true))), (0)::bigint) AS shipments_count,
    COALESCE(( SELECT avg(cs.effective_rate_pct) AS avg
           FROM customs_shipments cs
          WHERE ((cs.supplier_id = p.id) AND (cs.is_active = true) AND (cs.shipment_date >= (CURRENT_DATE - '90 days'::interval)))), (0)::numeric) AS avg_customs_rate_90d
   FROM partners p
  WHERE (is_active = true);

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
