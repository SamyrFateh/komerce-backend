/**
 * @komerce-arch
 * @role          purchasing-cancel-service
 * @domain        purchasing
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, utils/alerts.js, utils/logger.js
 * @used-by       services/cancel-order-purchase-orders.js
 * @db-read       purchase_orders
 * @db-write      alerts, purchase_orders
 * @db-txn        caller_managed
 * @doctrine      writer_not_owner_campaign_2026_08
 * @impact-areas  orders, purchasing, cancellation
 * @version       2026-08
 */

'use strict';

/**
 * LOT1 WRITER-NOT-OWNER — frontière propriétaire de purchase_orders.
 *
 * La commande déclenche l'intention d'annulation, mais seul le domaine
 * purchasing manipule le lifecycle des bons de commande. Le client `q` est
 * fourni par orders afin de conserver exactement la transaction existante.
 *
 * Doctrine prudente :
 * - POs pending/notified : annulées automatiquement avec la commande.
 * - POs confirmed/received/partially_received : pas de forçage, alerte opérationnelle.
 * - POs déjà cancelled : ignorées.
 */

const db = require('../db');
const { createAlert } = require('../utils/alerts');
const log = require('../utils/logger').child({ module: 'purchasing-cancel-service' });

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
  // `q` peut être le pool `db` (appel autonome) OU le client transactionnel
  // de la machine de statut. Un échec d'alerte ne doit pas empoisonner la
  // transaction d'annulation ; le SAVEPOINT conserve ce contrat historique.
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
    log.error({ err }, '[I-SWEEP-5A] failed to insert purchasing cancel alert:');
  }
}

module.exports = {
  syncPurchaseOrdersOnOrderCancel,
  AUTO_CANCEL_STATUSES,
  BLOCKING_STATUSES,
};
