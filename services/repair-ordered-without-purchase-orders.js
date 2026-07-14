/**
 * @komerce-arch
 * @role          orders-repair-ordered-without-purchase-orders
 * @domain        purchasing
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, routes/purchasing.js
 * @used-by       routes/admin/system.js
 * @db-read       orders, purchase_orders
 * @db-write      alerts
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  purchasing, checkout
 * @version       2026-06
 */

'use strict';

/**
 * I-SWEEP-3C — Repair explicite des commandes ordered sans purchase_orders.
 *
 * Cas couvert : crash ou erreur post-commit après paiement/transition ordered,
 * avant que triggerPurchasing(orderId) ait pu créer les POs.
 *
 * Le service ne modifie pas orders.status. Il relance uniquement le sourcing via
 * triggerPurchasing(orderId), désormais idempotent depuis I-SWEEP-3B.
 */

const db = require('../db');
const { createAlert } = require('../utils/alerts');

async function repairOrderedWithoutPurchaseOrders({ dryRun = true, limit = 25, user }) {
  if (!user?.id || user.role !== 'admin') {
    return { status: 403, body: { error: 'Accès réservé admin' } };
  }

  const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 25, 100));

  const { rows: candidates } = await db.query(`
    SELECT o.id, o.reference, o.created_at, o.updated_at
    FROM orders o
    WHERE o.status = 'ordered'
      AND NOT EXISTS (
        SELECT 1 FROM purchase_orders po
        WHERE po.order_id = o.id
          AND po.status != 'cancelled'
      )
    ORDER BY o.updated_at ASC NULLS FIRST, o.created_at ASC
    LIMIT $1
  `, [safeLimit]);

  if (dryRun) {
    return {
      status: 200,
      body: {
        dry_run: true,
        count: candidates.length,
        candidates,
      },
    };
  }

  const { triggerPurchasing } = require('../routes/purchasing');
  const repaired = [];
  const failed = [];

  for (const order of candidates) {
    try {
      const result = await triggerPurchasing(order.id);
      repaired.push({
        order_id: order.id,
        reference: order.reference,
        result,
      });
    } catch (err) {
      failed.push({
        order_id: order.id,
        reference: order.reference,
        error: err.message,
      });

      try {
        await createAlert(db, {
          type: 'purchasing_repair_failed',
          entityType: 'order',
          entityId: order.id,
          severity: 'medium',
          title: `Repair sourcing failed for ordered order ${order.reference}`,
          description: `error=${err.message}`,
        });
      } catch (_e) { /* non-bloquant */ }
    }
  }

  return {
    status: failed.length ? 207 : 200,
    body: {
      dry_run: false,
      scanned: candidates.length,
      repaired_count: repaired.length,
      failed_count: failed.length,
      repaired,
      failed,
    },
  };
}

module.exports = { repairOrderedWithoutPurchaseOrders };
