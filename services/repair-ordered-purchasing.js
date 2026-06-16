/**
 * @komerce-arch
 * @role          orders-repair-ordered-purchasing
 * @domain        orders
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
 * @db-read       order_items, orders, purchase_orders
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  orders, checkout
 * @version       2026-06
 */

'use strict';

/**
 * I-SWEEP-3C — Repair manuel commandes ordered sans purchase_orders.
 *
 * Contexte : après paiement confirmé, triggerPurchasing(orderId) est déclenché
 * post-commit. Si le process crash entre le commit paiement et ce side-effect,
 * une commande peut rester `ordered` sans POs.
 *
 * Ce service détecte ces commandes et peut relancer triggerPurchasing(orderId).
 * triggerPurchasing est idempotent depuis I-SWEEP-3B.
 */

const db = require('../db');

async function findOrderedWithoutPurchaseOrders({ limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));

  const { rows } = await db.query(`
    SELECT o.id, o.reference, o.status, o.payment_status, o.payment_mode,
           o.created_at, o.updated_at,
           COUNT(oi.id) AS item_count
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN purchase_orders po
      ON po.order_id = o.id
     AND po.status != 'cancelled'
    WHERE o.status = 'ordered'
      AND o.payment_status = 'paid'
      AND po.id IS NULL
    GROUP BY o.id
    ORDER BY o.updated_at ASC NULLS FIRST, o.created_at ASC
    LIMIT $1
  `, [safeLimit]);

  return rows;
}

async function repairOrderedWithoutPurchaseOrders({ limit = 20, dryRun = true, triggerPurchasing } = {}) {
  if (typeof triggerPurchasing !== 'function' && !dryRun) {
    throw new Error('[repairOrderedWithoutPurchaseOrders] triggerPurchasing requis en mode repair');
  }

  const candidates = await findOrderedWithoutPurchaseOrders({ limit });

  const results = [];
  for (const order of candidates) {
    if (dryRun) {
      results.push({
        order_id: order.id,
        reference: order.reference,
        action: 'would_trigger_purchasing',
        item_count: Number(order.item_count),
      });
      continue;
    }

    try {
      const repairResult = await triggerPurchasing(order.id);
      results.push({
        order_id: order.id,
        reference: order.reference,
        action: 'triggered_purchasing',
        result: repairResult,
      });
    } catch (err) {
      results.push({
        order_id: order.id,
        reference: order.reference,
        action: 'error',
        error: err.message,
      });
    }
  }

  return {
    dry_run: Boolean(dryRun),
    candidate_count: candidates.length,
    results,
  };
}

module.exports = {
  findOrderedWithoutPurchaseOrders,
  repairOrderedWithoutPurchaseOrders,
};
