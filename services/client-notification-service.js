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

const ORDER_MILESTONES = Object.freeze({
  preparation: {
    eventKey: 'order.preparation',
    severity: 'important',
    title: 'Votre commande est en préparation',
    message: reference => `Commande ${reference} : nous préparons votre colis.`,
  },
  shipped: {
    eventKey: 'order.shipped',
    severity: 'important',
    title: 'Votre commande a été expédiée',
    message: reference => `Commande ${reference} : votre colis est en route vers le relais.`,
  },
  available: {
    eventKey: 'order.pickup_ready',
    severity: 'urgent',
    title: 'Votre colis est disponible',
    message: (reference, relaisName) => relaisName
      ? `Commande ${reference} à retirer au relais ${relaisName}.`
      : `Commande ${reference} prête à être retirée au relais.`,
  },
});

const MILESTONE_EVENT_KEYS = Object.values(ORDER_MILESTONES).map(row => row.eventKey);
const PICKUP_READY_EVENT = ORDER_MILESTONES.available.eventKey;

async function emitOrderMilestone({ dbClient, status, userId, orderId, orderReference, relaisName = null }) {
  const milestone = ORDER_MILESTONES[status];
  if (!milestone || !userId || !orderId || !orderReference) return null;
  const q = dbClient || db;
  await q.query(
    `UPDATE client_notifications
        SET status = 'resolved', resolved_at = COALESCE(resolved_at, NOW())
      WHERE user_id = $1 AND entity_type = 'order' AND entity_id = $2
        AND event_key = ANY($3::text[]) AND event_key <> $4 AND status = 'open'`,
    [userId, orderId, MILESTONE_EVENT_KEYS, milestone.eventKey]
  );
  const { rows } = await q.query(
    `INSERT INTO client_notifications (
       user_id, event_key, entity_type, entity_id, order_reference,
       severity, title, message, action_target, requires_ack
     ) VALUES ($1, $2, 'order', $3, $4, $5, $6, $7, 'orders', TRUE)
     ON CONFLICT (user_id, event_key, entity_type, entity_id) DO NOTHING
     RETURNING *`,
    [
      userId,
      milestone.eventKey,
      orderId,
      orderReference,
      milestone.severity,
      milestone.title,
      milestone.message(orderReference, relaisName),
    ]
  );
  return rows[0] || null;
}

async function emitPickupReady(options) {
  return emitOrderMilestone({ ...options, status: 'available' });
}

async function emitExceptional({
  dbClient, eventKey, userId, orderId, orderReference,
  title, message, severity = 'urgent',
}) {
  if (!/^order\.exception\.[a-z0-9_.-]+$/.test(String(eventKey || ''))) {
    throw new Error('[client-notifications] eventKey exceptionnel invalide');
  }
  if (!['important', 'urgent'].includes(severity)) {
    throw new Error('[client-notifications] severity exceptionnelle invalide');
  }
  if (!userId || !orderId || !orderReference || !title || !message) return null;
  const q = dbClient || db;
  const { rows } = await q.query(
    `INSERT INTO client_notifications (
       user_id, event_key, entity_type, entity_id, order_reference,
       severity, title, message, action_target, requires_ack
     ) VALUES ($1, $2, 'order', $3, $4, $5, $6, $7, 'orders', TRUE)
     ON CONFLICT (user_id, event_key, entity_type, entity_id) DO NOTHING
     RETURNING *`,
    [userId, eventKey, orderId, orderReference, severity, title, message]
  );
  return rows[0] || null;
}

/** Répare une émission manquée sans créer de doublon. */
async function reconcileOrderMilestonesForUser(userId, { dbClient } = {}) {
  const q = dbClient || db;
  await q.query(
    `UPDATE client_notifications n
        SET status = 'resolved', resolved_at = COALESCE(n.resolved_at, NOW())
       FROM orders o
      WHERE n.user_id = $1
        AND n.entity_type = 'order'
        AND n.entity_id = o.id
        AND n.event_key = ANY($2::text[])
        AND n.status = 'open'
        AND n.event_key IS DISTINCT FROM CASE
              WHEN o.status = 'preparation' THEN 'order.preparation'
              WHEN o.status IN ('shipped', 'in_transit') THEN 'order.shipped'
              WHEN o.status = 'available' THEN 'order.pickup_ready'
              ELSE NULL
            END`,
    [userId, MILESTONE_EVENT_KEYS]
  );
  await q.query(
    `INSERT INTO client_notifications (
       user_id, event_key, entity_type, entity_id, order_reference,
       severity, title, message, action_target, requires_ack
     )
     SELECT o.user_id,
            CASE WHEN o.status = 'preparation' THEN 'order.preparation'
                 WHEN o.status IN ('shipped', 'in_transit') THEN 'order.shipped'
                 ELSE 'order.pickup_ready' END,
            'order', o.id, o.reference,
            CASE WHEN o.status = 'available' THEN 'urgent' ELSE 'important' END,
            CASE WHEN o.status = 'preparation' THEN 'Votre commande est en préparation'
                 WHEN o.status IN ('shipped', 'in_transit') THEN 'Votre commande a été expédiée'
                 ELSE 'Votre colis est disponible' END,
            CASE WHEN o.status = 'preparation'
                 THEN 'Commande ' || o.reference || ' : nous préparons votre colis.'
                 WHEN o.status IN ('shipped', 'in_transit')
                 THEN 'Commande ' || o.reference || ' : votre colis est en route vers le relais.'
                 WHEN r.name IS NULL
                 THEN 'Commande ' || o.reference || ' prête à être retirée au relais.'
                 ELSE 'Commande ' || o.reference || ' à retirer au relais ' || r.name || '.' END,
            'orders', TRUE
       FROM orders o
       LEFT JOIN relais r ON r.id = o.relais_id
      WHERE o.user_id = $1 AND o.status IN ('preparation', 'shipped', 'in_transit', 'available')
     ON CONFLICT (user_id, event_key, entity_type, entity_id) DO NOTHING`,
    [userId]
  );
}

async function reconcilePickupReadyForUser(userId, options) {
  return reconcileOrderMilestonesForUser(userId, options);
}

async function listOpenForUser(userId, { dbClient } = {}) {
  const q = dbClient || db;
  await reconcileOrderMilestonesForUser(userId, { dbClient: q });
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

async function resolveOrderMilestones(orderId, { dbClient } = {}) {
  const q = dbClient || db;
  const { rowCount } = await q.query(
    `UPDATE client_notifications
        SET status = 'resolved', resolved_at = COALESCE(resolved_at, NOW())
      WHERE entity_type = 'order' AND entity_id = $1 AND event_key = ANY($2::text[])
        AND status = 'open'`,
    [orderId, MILESTONE_EVENT_KEYS]
  );
  return rowCount;
}

async function resolvePickupForOrder(orderId, options) {
  return resolveOrderMilestones(orderId, options);
}

module.exports = {
  PICKUP_READY_EVENT,
  ORDER_MILESTONES,
  emitOrderMilestone,
  emitPickupReady,
  emitExceptional,
  reconcileOrderMilestonesForUser,
  reconcilePickupReadyForUser,
  listOpenForUser,
  acknowledgeForUser,
  resolveOrderMilestones,
  resolvePickupForOrder,
};
