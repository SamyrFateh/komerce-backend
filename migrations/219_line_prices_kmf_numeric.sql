-- @migration 219_line_prices_kmf_numeric.sql
-- @domain    orders
-- @purpose   Chantier currency debt (audit 09-2026), LOT 6 — les 4 colonnes
--            de PRIX LIGNE restées integer, les plus exposées du chantier
--            (86 fichiers chacune) :
--
--              order_items.price_kmf       (prix ligne de commande)
--              basket_items.price_kmf      (prix ligne de panier)
--              product_skus.price_kmf      (prix par SKU)
--              product_variants.price_kmf  (prix par variante)
--
--            Contexte : un audit de l'état réel après le LOT 5 (intitulé
--            « clôture ») a montré que 24 colonnes monétaires restaient en
--            integer sur 120 — comptées sur une base neuve où TOUTES les
--            migrations sont appliquées, pas sur le dump canonique, qui
--            reflète la base live et retarde sur les migrations mergées.
--
--            Ces 4 colonnes sont le trou le plus sérieux du reliquat :
--            orders.total_kmf et products.price_kmf ont été convertis
--            (migrations 213/215), mais les LIGNES qui composent ce total ne
--            l'étaient pas. Sur un marché en EUR, chaque ligne de panier ou
--            de commande aurait été arrondie à l'unité AVANT d'être sommée —
--            le total converti n'aurait jamais pu être juste.
--
--            Ce défaut a été rencontré concrètement pendant le LOT 2 : une
--            insertion de 12345.67 dans order_items.price_kmf avait été
--            silencieusement arrondie par Postgres à 12346, faussant une
--            marge de test. Le contournement d'alors (changer les montants
--            du test) traitait le symptôme ; cette migration traite la cause.
--
--            Précision NUMERIC(12,2), alignée sur products.price_kmf
--            (migration 215) — ce sont des prix unitaires de même nature.
--
--            Trois vues dépendent de order_items.price_kmf / product_variants
--            .price_kmf et bloquent l'ALTER TYPE (trouvé par pg_depend sur
--            une base réellement migrée, pas par lecture du dump) :
--            product_variants_ordered, v_ceremony_orders, v_shipment_density.
--            Recréées à l'identique ci-dessous, d'après pg_get_viewdef() de
--            la base migrée — donc y compris les casts ::numeric que la
--            migration 215 avait déjà introduits dans v_shipment_density.
--            Aucune vue ne dépend d'une autre (vérifié) : pas de cascade.
--
--            Aucun trigger n'est défini sur ces colonnes : ceux d'order_items
--            et product_variants sont column-specific mais portent sur
--            fulfillment_source et product_id, pas sur price_kmf.
--
--            Contraintes CHECK inchangées, identiques pour integer et
--            numeric : chk_order_items_price (> 0),
--            product_skus_prix_non_negatif / product_variants_prix_non_negatif
--            (IS NULL OR >= 0).

DROP VIEW IF EXISTS v_shipment_density;
DROP VIEW IF EXISTS v_ceremony_orders;
DROP VIEW IF EXISTS product_variants_ordered;

ALTER TABLE order_items      ALTER COLUMN price_kmf TYPE NUMERIC(12,2);
ALTER TABLE basket_items     ALTER COLUMN price_kmf TYPE NUMERIC(12,2);
ALTER TABLE product_skus     ALTER COLUMN price_kmf TYPE NUMERIC(12,2);
ALTER TABLE product_variants ALTER COLUMN price_kmf TYPE NUMERIC(12,2);

CREATE VIEW product_variants_ordered AS
 SELECT id,
    product_id,
    variant_type,
    variant_value,
    sku,
    COALESCE(stock, 0) AS stock,
    price_kmf,
    image_url,
    display_order,
    created_at,
    updated_at,
    images
   FROM product_variants
  ORDER BY product_id, variant_type, display_order, created_at;

CREATE VIEW v_ceremony_orders AS
 SELECT oi.id AS item_id,
    o.id AS order_id,
    o.reference AS order_ref,
    o.created_at::date AS order_date,
    o.status AS order_status,
    COALESCE(oi.module_type, o.module_type) AS ceremony_type,
    p.name AS product_name,
    COALESCE(oi.module_fabric_type, o.module_fabric_type) AS fabric_type,
    COALESCE(oi.module_size, o.module_size) AS size,
    COALESCE(oi.module_retouche, o.module_retouche) AS retouche,
    COALESCE(oi.module_qty_meters, o.module_qty_meters) AS qty_meters,
    COALESCE(oi.module_accessories, o.module_accessories) AS accessories,
    oi.price_kmf AS unit_price_kmf,
    oi.quantity,
    oi.price_kmf * oi.quantity AS total_item_kmf,
    u.full_name AS client_name,
    u.phone AS client_phone,
    r.name AS relais_name,
    pa.name AS artisan_name,
    pa.phone AS artisan_phone
   FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN products p ON p.id = oi.product_id
     LEFT JOIN users u ON u.id = o.user_id
     LEFT JOIN relais r ON r.id = o.relais_id
     LEFT JOIN partners pa ON pa.id = o.confection_artisan_id
  WHERE COALESCE(oi.module_type, o.module_type) IS NOT NULL;

CREATE VIEW v_shipment_density AS
 WITH parcel_vol AS (
         SELECT csp.shipment_id,
            csp.parcel_id,
            csp.parcel_weight_kg,
            COALESCE(csp.parcel_volume_cm3, p.volume_cm3) AS volume_cm3
           FROM customs_shipment_parcels csp
             LEFT JOIN parcels p ON p.id = csp.parcel_id
        ), margin_embarked AS (
         SELECT pv_1.shipment_id,
            sum((COALESCE(oi.price_kmf, 0) * COALESCE(pi.quantity, 1))::numeric - COALESCE(pr.cost_kmf, oi.price_kmf::numeric, 0::numeric) * COALESCE(pi.quantity, 1)::numeric) AS margin_kmf
           FROM parcel_vol pv_1
             JOIN parcel_items pi ON pi.parcel_id = pv_1.parcel_id
             JOIN order_items oi ON oi.id = pi.order_item_id
             LEFT JOIN products pr ON pr.id = pi.product_id
          GROUP BY pv_1.shipment_id
        )
 SELECT cs.id AS shipment_id,
    cs.reference,
    cs.transport_mode,
    cs.total_weight_kg,
    cs.total_volume_m3,
    sum(pv.parcel_weight_kg) AS parcels_weight_kg,
    sum(pv.volume_cm3) / 1000000.0 AS parcels_volume_m3,
    GREATEST(COALESCE(cs.total_weight_kg, sum(pv.parcel_weight_kg)) / 1000.0, COALESCE(cs.total_volume_m3, sum(pv.volume_cm3) / 1000000.0)) AS chargeable_wm,
        CASE
            WHEN cs.total_volume_m3 > 0::numeric AND sum(pv.volume_cm3) > 0::numeric THEN round(sum(pv.volume_cm3) / 1000000.0 / cs.total_volume_m3 * 100::numeric, 1)
            ELSE NULL::numeric
        END AS fill_rate_pct,
    me.margin_kmf AS margin_embarked_kmf,
        CASE
            WHEN cs.total_volume_m3 > 0::numeric THEN round(me.margin_kmf / cs.total_volume_m3, 0)
            ELSE NULL::numeric
        END AS margin_kmf_per_m3,
    cs.freight_kmf,
    cs.status
   FROM customs_shipments cs
     LEFT JOIN parcel_vol pv ON pv.shipment_id = cs.id
     LEFT JOIN margin_embarked me ON me.shipment_id = cs.id
  WHERE cs.is_active = true
  GROUP BY cs.id, cs.reference, cs.transport_mode, cs.total_weight_kg, cs.total_volume_m3, cs.freight_kmf, cs.status, me.margin_kmf;
