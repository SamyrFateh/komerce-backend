/**
 * @komerce-arch
 * @role          client-notification-service
 * @domain        notification
 * @layer         service
 * @criticality   high
 * @inputs        confirmed business event, authenticated user
 * @outputs       idempotent in-app notification lifecycle
 * @depends       db.js
 * @used-by       services/order-status-machine.js, routes/client-notifications.js
 * @db-read       client_notifications, orders, relais
 * @db-write      client_notifications
 * @db-txn        best_effort_after_unwrapped_transition, read_reconciliation
 * @doctrine      DOCTRINE_NOTIFICATIONS_CLIENT_KOMERCE.md
 * @impact-areas  notifications, orders, boutique
 * @version       2026-08
 */

'use strict';

const db = require('../db');

const PICKUP_READY_EVENT = 'order.pickup_ready';

function pickupMessage(orderReference, relaisName) {
  return relaisName
    ? `Commande ${orderReference} à retirer au relais ${relaisName}.`
    : `Commande ${orderReference} prête à être retirée au relais.`;
}

async function emitPickupReady({ dbClient, userId, orderId, orderReference, relaisName = null }) {
  if (!userId || !orderId || !orderReference) return null;
  const q = dbClient || db;
  const { rows } = await q.query(
    `INSERT INTO client_notifications (
       user_id, event_key, entity_type, entity_id, order_reference,
       severity, title, message, action_target, requires_ack
     ) VALUES ($1, $2, 'order', $3, $4, 'urgent', $5, $6, 'orders', TRUE)
     ON CONFLICT (user_id, event_key, entity_type, entity_id) DO NOTHING
     RETURNING *`,
    [
      userId,
      PICKUP_READY_EVENT,
      orderId,
      orderReference,
      'Votre colis est disponible',
      pickupMessage(orderReference, relaisName),
    ]
  );
  return rows[0] || null;
}

/** Répare une émission manquée sans créer de doublon. */
async function reconcilePickupReadyForUser(userId, { dbClient } = {}) {
  const q = dbClient || db;
  await q.query(
    `UPDATE client_notifications n
        SET status = 'resolved', resolved_at = COALESCE(n.resolved_at, NOW())
       FROM orders o
      WHERE n.user_id = $1
        AND n.entity_type = 'order'
        AND n.entity_id = o.id
        AND n.event_key = $2
        AND n.status = 'open'
        AND o.status <> 'available'`,
    [userId, PICKUP_READY_EVENT]
  );
  await q.query(
    `INSERT INTO client_notifications (
       user_id, event_key, entity_type, entity_id, order_reference,
       severity, title, message, action_target, requires_ack
     )
     SELECT o.user_id, $2, 'order', o.id, o.reference,
            'urgent', 'Votre colis est disponible',
            CASE WHEN r.name IS NULL
                 THEN 'Commande ' || o.reference || ' prête à être retirée au relais.'
                 ELSE 'Commande ' || o.reference || ' à retirer au relais ' || r.name || '.' END,
            'orders', TRUE
       FROM orders o
       LEFT JOIN relais r ON r.id = o.relais_id
      WHERE o.user_id = $1 AND o.status = 'available'
     ON CONFLICT (user_id, event_key, entity_type, entity_id) DO NOTHING`,
    [userId, PICKUP_READY_EVENT]
  );
}

async function listOpenForUser(userId, { dbClient } = {}) {
  const q = dbClient || db;
  await reconcilePickupReadyForUser(userId, { dbClient: q });
  const { rows } = await q.query(
    `SELECT id, event_key, severity, title, message, action_target,
            order_reference, requires_ack, created_at
       FROM client_notifications
      WHERE user_id = $1 AND status = 'open'
      ORDER BY CASE severity WHEN 'urgent' THEN 0 ELSE 1 END, created_at DESC
      LIMIT 20`,
    [userId]
  );
  return rows;
}

async function acknowledgeForUser(userId, notificationId, { dbClient } = {}) {
  const q = dbClient || db;
  const { rows } = await q.query(
    `UPDATE client_notifications
        SET status = 'acknowledged', acknowledged_at = COALESCE(acknowledged_at, NOW())
      WHERE id = $1 AND user_id = $2 AND status = 'open'
      RETURNING id, status, acknowledged_at`,
    [notificationId, userId]
  );
  return rows[0] || null;
}

async function resolvePickupForOrder(orderId, { dbClient } = {}) {
  const q = dbClient || db;
  const { rowCount } = await q.query(
    `UPDATE client_notifications
        SET status = 'resolved', resolved_at = COALESCE(resolved_at, NOW())
      WHERE entity_type = 'order' AND entity_id = $1 AND event_key = $2
        AND status = 'open'`,
    [orderId, PICKUP_READY_EVENT]
  );
  return rowCount;
}

module.exports = {
  PICKUP_READY_EVENT,
  emitPickupReady,
  reconcilePickupReadyForUser,
  listOpenForUser,
  acknowledgeForUser,
  resolvePickupForOrder,
};
