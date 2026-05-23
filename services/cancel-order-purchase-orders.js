'use strict';

/**
 * I-SWEEP-5A — Synchronisation annulation commande ↔ purchase_orders.
 *
 * Doctrine prudente :
 * - POs pending/notified : annulées automatiquement avec la commande.
 * - POs confirmed/received/partially_received : pas de forçage, alerte opérationnelle.
 * - POs déjà cancelled : ignorées.
 *
 * Le service est appelé dans la transaction de la machine de statut.
 */

const db = require('../db');
const log = require('../utils/logger').child({ module: 'cancel-order-purchase-orders' });

const AUTO_CANCEL_STATUSES = ['pending', 'notified'];
const BLOCKING_STATUSES = ['confirmed', 'received', 'partially_received', 'hub_received'];

async function syncPurchaseOrdersOnOrderCancel(q = db, { orderId, orderReference = null, actor = null, reason = null } = {}) {
  if (!orderId) throw new Error('[syncPurchaseOrdersOnOrderCancel] orderId requis');

  const { rows: purchaseOrders } = await q.query(
    `SELECT id, status, supplier_id, supplier_order_id
       FROM purchase_orders
      WHERE order_id = $1
        AND status != 'cancelled'
      FOR UPDATE`,
    [orderId]
  );

  if (!purchaseOrders.length) {
    return { total: 0, auto_cancelled: 0, blocking: 0, blocking_pos: [] };
  }

  const autoIds = purchaseOrders
    .filter(po => AUTO_CANCEL_STATUSES.includes(po.status))
    .map(po => po.id);

  const blockingPos = purchaseOrders
    .filter(po => !AUTO_CANCEL_STATUSES.includes(po.status))
    .map(po => ({
      id: po.id,
      status: po.status,
      supplier_id: po.supplier_id,
      supplier_order_id: po.supplier_order_id || null,
    }));

  if (autoIds.length) {
    await q.query(
      `UPDATE purchase_orders
          SET status = 'cancelled',
              updated_at = NOW(),
              notes = CONCAT(COALESCE(notes, ''), $2)
        WHERE id = ANY($1::uuid[])`,
      [
        autoIds,
        `\n[I-SWEEP-5A] Annulée automatiquement avec la commande${reason ? ` — ${reason}` : ''}`,
      ]
    );
  }

  if (blockingPos.length) {
    await insertBlockingAlert(q, {
      orderId,
      orderReference,
      actor,
      reason,
      blockingPos,
    });
  }

  return {
    total: purchaseOrders.length,
    auto_cancelled: autoIds.length,
    blocking: blockingPos.length,
    blocking_pos: blockingPos,
  };
}

async function insertBlockingAlert(q, { orderId, orderReference, actor, reason, blockingPos }) {
  try {
    await q.query(
      `INSERT INTO alerts (level, source, message, payload)
       VALUES ('elevated', 'order_cancel_purchasing', $1, $2)`,
      [
        `Commande annulée avec PO fournisseur déjà engagée${orderReference ? ` — ${orderReference}` : ''}`,
        JSON.stringify({
          order_id: orderId,
          order_reference: orderReference,
          actor,
          reason,
          blocking_purchase_orders: blockingPos,
          doctrine: 'pending/notified auto-cancelled; engaged POs require manual handling',
        }),
      ]
    );
  } catch (err) {
    // Ne jamais casser l'annulation métier uniquement parce que l'alerte échoue.
    log.error('[I-SWEEP-5A] failed to insert purchasing cancel alert:', err.message);
  }
}

module.exports = {
  syncPurchaseOrdersOnOrderCancel,
  AUTO_CANCEL_STATUSES,
  BLOCKING_STATUSES,
};
