/**
 * @komerce-arch
 * @role          orders-cancel-order-purchase-orders
 * @domain        orders
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, utils/logger.js
 * @used-by       services/order-status-machine.js
 * @db-read       purchase_orders
 * @db-write      alerts, purchase_orders
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  orders, checkout
 * @version       2026-06
 */

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
const { createAlert } = require('../utils/alerts');
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
              notes = CONCAT(COALESCE(notes, ''), $2::text)
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
  // P0-F : `q` peut être le pool `db` (appel autonome) OU le client
  // transactionnel de la machine de statut (appel imbriqué dans le BEGIN de
  // l'annulation de commande). Dans ce second cas, un échec de persistance
  // de CETTE alerte ne doit jamais empoisonner `q` : les queries suivantes
  // de order-status-machine.js (et son COMMIT final) partagent le même
  // client. D'où le SAVEPOINT, tenté dans les deux cas : s'il échoue parce
  // que `q` n'est pas dans une transaction (cas pool), c'est sans
  // conséquence — chaque appel pool.query() est une connexion autonome.
  let savepointActive = false;
  try {
    await q.query('SAVEPOINT cancel_order_po_alert');
    savepointActive = true;
  } catch (_e) { /* q hors transaction (pool) — pas de savepoint nécessaire */ }

  try {
    await createAlert(q, {
      type: 'order_cancel_purchasing_blocked',
      entityType: 'order',
      entityId: orderId,
      severity: 'medium',
      title: `Commande annulée avec PO fournisseur déjà engagée${orderReference ? ` — ${orderReference}` : ''}`,
      description: `actor=${JSON.stringify(actor)} reason=${reason || 'n/a'} ` +
        `blocking_purchase_orders=${JSON.stringify(blockingPos)} ` +
        `doctrine=pending/notified auto-cancelled; engaged POs require manual handling`,
    });
    if (savepointActive) await q.query('RELEASE SAVEPOINT cancel_order_po_alert').catch(() => {});
  } catch (err) {
    if (savepointActive) await q.query('ROLLBACK TO SAVEPOINT cancel_order_po_alert').catch(() => {});
    // Invariant du service (§ doc module) : l'échec de création de l'alerte
    // ne doit jamais casser l'annulation métier.
    log.error({ err }, '[I-SWEEP-5A] failed to insert purchasing cancel alert:');
  }
}

module.exports = {
  syncPurchaseOrdersOnOrderCancel,
  AUTO_CANCEL_STATUSES,
  BLOCKING_STATUSES,
};
