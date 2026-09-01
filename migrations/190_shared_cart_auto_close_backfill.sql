-- 190_shared_cart_auto_close_backfill.sql
--
-- Régression réparée 2026-09-01 : certaines listes entièrement réclamées
-- sont restées OPEN après la simplification Boutique First. Le runtime ferme
-- désormais la liste après le commit de la commande qui réclame la dernière
-- ligne ; cette migration réconcilie une seule fois les données déjà stale.
--
-- Invariant restauré :
--   toutes les shared_cart_items ont un order_item -> shared_carts.status=closed
--
-- L'UPDATE + l'événement d'audit vivent dans le même statement (et le runner
-- exécute lui-même chaque migration dans une transaction).

WITH stale AS (
  SELECT sc.id,
         COALESCE(
           (
             SELECT MAX(o.created_at)
               FROM shared_cart_items sci
               JOIN order_items oi ON oi.shared_cart_item_id = sci.id
               JOIN orders o ON o.id = oi.order_id
              WHERE sci.shared_cart_id = sc.id
           ),
           NOW()
         ) AS completed_at
    FROM shared_carts sc
   WHERE sc.status = 'open'
     AND EXISTS (
       SELECT 1
         FROM shared_cart_items sci
        WHERE sci.shared_cart_id = sc.id
     )
     AND NOT EXISTS (
       SELECT 1
         FROM shared_cart_items sci
        WHERE sci.shared_cart_id = sc.id
          AND NOT EXISTS (
            SELECT 1
              FROM order_items oi
             WHERE oi.shared_cart_item_id = sci.id
          )
     )
),
closed AS (
  UPDATE shared_carts sc
     SET status = 'closed',
         closed_at = stale.completed_at,
         updated_at = NOW()
    FROM stale
   WHERE sc.id = stale.id
   RETURNING sc.id, sc.closed_at
)
INSERT INTO shared_cart_events (
  shared_cart_id,
  event_type,
  actor_type,
  actor_id,
  payload
)
SELECT closed.id,
       'cart_closed',
       'system',
       NULL,
       jsonb_build_object(
         'closed_at', closed.closed_at,
         'reason', 'all_items_claimed',
         'reconciled_by', 'migration_190'
       )
  FROM closed;
