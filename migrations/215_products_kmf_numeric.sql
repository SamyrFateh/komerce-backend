-- @migration 215_products_kmf_numeric.sql
-- @domain    catalog
-- @purpose   Chantier currency debt (audit 09-2026), LOT 2 — les 3 colonnes
--            monétaires integer de products : price_kmf, cost_kmf,
--            unsold_price_kmf -> numeric(12,2). Précision alignée sur
--            products.price_eur (déjà numeric(12,2)), cohérente au sein de
--            la même table.
--
--            price_kmf est l'exemple le plus critique après orders.total_kmf :
--            le prix produit affiché et vendu, 76 fichiers le référencent.
--            NOT NULL, CHECK (price_kmf > 0) — la contrainte reste valide
--            sans modification, la comparaison > 0 est identique pour
--            integer et numeric.
--
--            price_aed (numeric(10,2)) et price_eur (numeric(12,2)) restent
--            inchangées : déjà au bon type. Les fusionner avec price_kmf en
--            un couple (amount, currency) est une décision de modélisation
--            distincte pour la table entière, pas traitée ici (cf. plan
--            d'attaque devise).
--
--            v_shipment_density dépend de products.cost_kmf (trouvé par
--            exécution réelle — pg_depend, pas par lecture du dump) : elle
--            agrège une marge embarquée par expédition en joignant
--            customs_shipment_parcels -> parcel_items -> order_items ->
--            products. Recréée à l'identique ci-dessous. Aucune autre vue,
--            fonction ni trigger column-specific ne référence ces 3 colonnes
--            (recherche exhaustive avant écriture de cette migration :
--            pg_depend sur products, pg_trigger sur products, grep du dump
--            pour toute FUNCTION mentionnant price_kmf/cost_kmf).
--
--            trg_products_updated (BEFORE UPDATE, set_updated_at()) est
--            générique, sans clause column-specific : aucune modification
--            nécessaire.

DROP VIEW IF EXISTS v_shipment_density;

ALTER TABLE products
  ALTER COLUMN price_kmf TYPE NUMERIC(12,2),
  ALTER COLUMN cost_kmf TYPE NUMERIC(12,2),
  ALTER COLUMN unsold_price_kmf TYPE NUMERIC(12,2);

CREATE VIEW v_shipment_density AS
 WITH parcel_vol AS (
         SELECT csp.shipment_id,
            csp.parcel_id,
            csp.parcel_weight_kg,
            COALESCE(csp.parcel_volume_cm3, p.volume_cm3) AS volume_cm3
           FROM (customs_shipment_parcels csp
             LEFT JOIN parcels p ON ((p.id = csp.parcel_id)))
        ), margin_embarked AS (
         SELECT pv_1.shipment_id,
            sum(((COALESCE(oi.price_kmf, 0) * COALESCE(pi.quantity, 1)) - (COALESCE(pr.cost_kmf, oi.price_kmf, 0) * COALESCE(pi.quantity, 1)))) AS margin_kmf
           FROM (((parcel_vol pv_1
             JOIN parcel_items pi ON ((pi.parcel_id = pv_1.parcel_id)))
             JOIN order_items oi ON ((oi.id = pi.order_item_id)))
             LEFT JOIN products pr ON ((pr.id = pi.product_id)))
          GROUP BY pv_1.shipment_id
        )
 SELECT cs.id AS shipment_id,
    cs.reference,
    cs.transport_mode,
    cs.total_weight_kg,
    cs.total_volume_m3,
    sum(pv.parcel_weight_kg) AS parcels_weight_kg,
    (sum(pv.volume_cm3) / 1000000.0) AS parcels_volume_m3,
    GREATEST((COALESCE(cs.total_weight_kg, sum(pv.parcel_weight_kg)) / 1000.0), COALESCE(cs.total_volume_m3, (sum(pv.volume_cm3) / 1000000.0))) AS chargeable_wm,
        CASE
            WHEN ((cs.total_volume_m3 > (0)::numeric) AND (sum(pv.volume_cm3) > (0)::numeric)) THEN round((((sum(pv.volume_cm3) / 1000000.0) / cs.total_volume_m3) * (100)::numeric), 1)
            ELSE NULL::numeric
        END AS fill_rate_pct,
    me.margin_kmf AS margin_embarked_kmf,
        CASE
            WHEN (cs.total_volume_m3 > (0)::numeric) THEN round(((me.margin_kmf)::numeric / cs.total_volume_m3), 0)
            ELSE NULL::numeric
        END AS margin_kmf_per_m3,
    cs.freight_kmf,
    cs.status
   FROM ((customs_shipments cs
     LEFT JOIN parcel_vol pv ON ((pv.shipment_id = cs.id)))
     LEFT JOIN margin_embarked me ON ((me.shipment_id = cs.id)))
  WHERE (cs.is_active = true)
  GROUP BY cs.id, cs.reference, cs.transport_mode, cs.total_weight_kg, cs.total_volume_m3, cs.freight_kmf, cs.status, me.margin_kmf;
