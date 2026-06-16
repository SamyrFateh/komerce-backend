/**
 * @komerce-arch
 * @role          orders-delete-order-cascade
 * @domain        orders
 * @layer         route
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  orders, checkout, admin-dashboard
 * @version       2026-06
 */

'use strict';

/**
 * Helper partagé — suppression d'une commande et de toutes ses dépendances.
 * Utilisé par : routes/admin/orders.js, routes/admin/system.js
 *
 * Tables enfants avec FK vers orders :
 *   order_items, scans, order_status_history, sms_log, disputes, ceremony_order_items
 *
 * Chaque DELETE est enveloppé dans un SAVEPOINT pour survivre aux tables absentes
 * (PG avorte la transaction sur erreur sans SAVEPOINT).
 */
async function deleteOrderCascade(client_or_db, id) {
  const childOps = [
    ['DELETE FROM scans WHERE order_id = $1::uuid', [id]],
    ['DELETE FROM order_status_history WHERE order_id = $1::uuid', [id]],
    ['DELETE FROM ceremony_order_items WHERE order_id = $1::uuid', [id]],
    ['DELETE FROM disputes WHERE order_id = $1::uuid', [id]],
    ['UPDATE sms_log SET order_id = NULL WHERE order_id = $1::uuid', [id]],
    ['DELETE FROM order_items WHERE order_id = $1::uuid', [id]],
  ];
  for (let i = 0; i < childOps.length; i++) {
    try {
      await client_or_db.query(`SAVEPOINT sp_del_${i}`);
      await client_or_db.query(childOps[i][0], childOps[i][1]);
      await client_or_db.query(`RELEASE SAVEPOINT sp_del_${i}`);
    } catch (_) {
      await client_or_db.query(`ROLLBACK TO SAVEPOINT sp_del_${i}`);
    }
  }
  await client_or_db.query('DELETE FROM orders WHERE id = $1::uuid', [id]);
}

module.exports = { deleteOrderCascade };
