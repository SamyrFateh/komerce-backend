/**
 * @komerce-arch
 * @role          orders-receive-purchase-order
 * @domain        orders
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/order-status-machine.js, utils/logger.js
 * @used-by       none
 * @db-read       purchase_orders
 * @db-write      purchase_orders
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  orders, checkout
 * @version       2026-06
 */

'use strict';

/**
 * I-SWEEP-3C — Réception hub transactionnelle.
 *
 * Corrige le risque G2 : la réception PO faisait update PO, calcul complétude,
 * transition order et trigger scan sans transaction globale.
 */

const db = require('../db');
const { transitionOrderStatus } = require('./order-status-machine');
const log = require('../utils/logger').child({ module: 'receive-purchase-order' });

async function receivePurchaseOrder({ poId, qtyReceived, actor, triggerScan3 }) {
  if (!poId) return { status: 400, body: { error: 'po_id requis' } };

  const qty_recue = qtyReceived !== undefined && qtyReceived !== null && qtyReceived !== ''
    ? parseInt(qtyReceived, 10)
    : null;

  if (qty_recue !== null && (Number.isNaN(qty_recue) || qty_recue < 0)) {
    return { status: 400, body: { error: 'qty_recue invalide' } };
  }

  const client = await db.getClient();
  let shouldTriggerScan3 = false;
  let triggerOrderId = null;

  try {
    await client.query('BEGIN');

    const { rows: [po] } = await client.query(
      `SELECT id, order_id, qty, received_qty, status, hub_received_at
       FROM purchase_orders
       WHERE id = $1
       FOR UPDATE`,
      [poId]
    );

    if (!po) {
      await client.query('ROLLBACK');
      return { status: 404, body: { error: 'PO introuvable' } };
    }

    const delta = qty_recue !== null
      ? Math.min(qty_recue, po.qty - po.received_qty)
      : po.qty - po.received_qty;

    if (delta <= 0) {
      await client.query('ROLLBACK');
      return { status: 400, body: { error: 'Quantité déjà reçue en totalité' } };
    }

    const newReceived = po.received_qty + delta;
    const poComplete = newReceived >= po.qty;

    const { rows: [updatedPo] } = await client.query(
      `UPDATE purchase_orders
       SET received_qty = $1,
           status = $2,
           hub_received_at = CASE WHEN $3 THEN NOW() ELSE hub_received_at END,
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [newReceived, poComplete ? 'hub_received' : 'confirmed', poComplete, po.id]
    );

    const { rows: [completeness] } = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE status != 'cancelled') AS total,
         COUNT(*) FILTER (WHERE received_qty >= qty AND status != 'cancelled') AS recus,
         COALESCE(SUM(qty) FILTER (WHERE status != 'cancelled'), 0) AS qty_totale,
         COALESCE(SUM(received_qty) FILTER (WHERE status != 'cancelled'), 0) AS qty_recue
       FROM purchase_orders
       WHERE order_id = $1`,
      [po.order_id]
    );

    const total = parseInt(completeness.total, 10);
    const recus = parseInt(completeness.recus, 10);
    const qtyTotale = parseInt(completeness.qty_totale, 10);
    const qtyRecueTotal = parseInt(completeness.qty_recue, 10);
    const orderComplete = total > 0 && recus === total;

    if (orderComplete) {
      const statusResult = await transitionOrderStatus({
        orderId: po.order_id,
        newStatus: 'preparation',
        actor: { id: actor?.id || null, role: actor?.role || 'system' },
        source: 'system',
        note: 'Tous les achats fournisseur recus au hub',
        dbClient: client,
      });

      if (!statusResult.success && !statusResult.noop) {
        await client.query('ROLLBACK');
        return { status: 409, body: { error: statusResult.error } };
      }

      shouldTriggerScan3 = true;
      triggerOrderId = po.order_id;
    }

    await client.query('COMMIT');

    if (shouldTriggerScan3 && typeof triggerScan3 === 'function') {
      triggerScan3(triggerOrderId, actor?.id || null)
        .catch(e => log.error({ err: e }, '[purchasing/receive] Erreur SMS SCAN3:'));
    }

    const itemsMissing = total - recus;

    return {
      status: 200,
      body: {
        success: true,
        po_status: updatedPo.status,
        order_id: po.order_id,
        order_status: orderComplete ? 'preparation' : 'ordered',
        ready_to_prepare: orderComplete,
        items_received: recus,
        items_total: total,
        items_missing: itemsMissing,
        qty_totale: qtyTotale,
        qty_recue: qtyRecueTotal,
        message: orderComplete
          ? `✅ Commande complète — ${total}/${total} articles — Prête à préparer`
          : `📦 Réception partielle — ${recus}/${total} articles — ${itemsMissing} manquant(s)`
      }
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { receivePurchaseOrder };
