-- HUB-001 historical preflight — READ ONLY, aucune réparation automatique.
-- À exécuter sur la base live AVANT activation de migration 233.

BEGIN TRANSACTION READ ONLY;

SELECT
  (SELECT COUNT(*) FROM inventory_items) AS inventory_items_total,
  (SELECT COUNT(*) FROM parcel_items) AS parcel_items_total,
  (SELECT COUNT(*)
     FROM inventory_items ii
     LEFT JOIN order_items oi ON oi.id = ii.order_item_id
    WHERE ii.order_item_id IS NULL
       OR oi.id IS NULL
       OR ii.order_id IS DISTINCT FROM oi.order_id
  ) AS inventory_order_identity_conflicts,
  (SELECT COUNT(*)
     FROM inventory_items ii
     JOIN order_items oi ON oi.id = ii.order_item_id
     JOIN orders o ON o.id = oi.order_id
     JOIN parcels p ON p.id = ii.parcel_id
     LEFT JOIN relais r ON r.id = p.relais_id
    WHERE ii.parcel_id IS NOT NULL
      AND (
        o.relais_id IS NULL OR o.market_id IS NULL
        OR p.relais_id IS NULL OR r.market_id IS NULL
        OR o.relais_id IS DISTINCT FROM p.relais_id
        OR o.market_id IS DISTINCT FROM r.market_id
      )
  ) AS inventory_assigned_destination_conflicts,
  (SELECT COUNT(*)
     FROM parcel_items pi
     LEFT JOIN order_items oi ON oi.id = pi.order_item_id
     LEFT JOIN orders o ON o.id = oi.order_id
     LEFT JOIN parcels p ON p.id = pi.parcel_id
     LEFT JOIN relais r ON r.id = p.relais_id
    WHERE oi.id IS NULL OR o.id IS NULL OR p.id IS NULL
       OR o.relais_id IS NULL OR o.market_id IS NULL
       OR p.relais_id IS NULL OR r.market_id IS NULL
       OR o.relais_id IS DISTINCT FROM p.relais_id
       OR o.market_id IS DISTINCT FROM r.market_id
  ) AS parcel_membership_destination_conflicts,
  (SELECT COUNT(*)
     FROM (
       SELECT parcel_id, order_item_id
         FROM parcel_items
        WHERE order_item_id IS NOT NULL
        GROUP BY parcel_id, order_item_id
       HAVING COUNT(*) > 1
     ) dup
  ) AS duplicate_parcel_order_item_groups,
  (SELECT COUNT(*)
     FROM (
       SELECT oi.id
         FROM order_items oi
         LEFT JOIN inventory_items ii
           ON ii.order_item_id = oi.id AND ii.status <> 'cancelled'
        GROUP BY oi.id, oi.quantity
       HAVING COALESCE(SUM(ii.quantity), 0) > COALESCE(oi.quantity, 1)
     ) over_received
  ) AS order_items_over_received;

SELECT
  pi.id AS parcel_item_id,
  pi.parcel_id,
  pi.order_item_id,
  o.id AS order_id,
  o.market_id AS order_market_id,
  o.relais_id AS order_relais_id,
  p.relais_id AS parcel_relais_id,
  r.market_id AS parcel_market_id
FROM parcel_items pi
LEFT JOIN order_items oi ON oi.id = pi.order_item_id
LEFT JOIN orders o ON o.id = oi.order_id
LEFT JOIN parcels p ON p.id = pi.parcel_id
LEFT JOIN relais r ON r.id = p.relais_id
WHERE oi.id IS NULL OR o.id IS NULL OR p.id IS NULL
   OR o.relais_id IS NULL OR o.market_id IS NULL
   OR p.relais_id IS NULL OR r.market_id IS NULL
   OR o.relais_id IS DISTINCT FROM p.relais_id
   OR o.market_id IS DISTINCT FROM r.market_id
ORDER BY pi.id
LIMIT 100;

SELECT parcel_id, order_item_id, COUNT(*) AS duplicate_rows, SUM(COALESCE(quantity, 0)) AS total_quantity
FROM parcel_items
WHERE order_item_id IS NOT NULL
GROUP BY parcel_id, order_item_id
HAVING COUNT(*) > 1
ORDER BY duplicate_rows DESC, parcel_id, order_item_id
LIMIT 100;

ROLLBACK;
