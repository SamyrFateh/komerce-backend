/**
 * @komerce-arch
 * @role          orders-order-parcel-link-rules
 * @domain        orders
 * @layer         util
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @db-write      none
 * @db-read      orders, parcels
 * @used-by       @unknown
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  orders, checkout, logistics
 * @version       2026-06
 */

/**
 * KOMERCE — Order ↔ Parcel Link Rules — v2.0 DEPRECATED
 *
 * ⚠️ DEPRECATED: This module is kept for backward compatibility only.
 * All order status transitions now go through services/order-status-machine.js
 * (architectural decisions D1/D2).
 *
 * The logic previously in R1/R3 is now handled by:
 *   - utils/parcelSync.js → computeOrderStatus() → machine
 *   - The machine's forward-only transition logic
 *
 * R2 (all parcels cancelled) is preserved as an observation signal.
 */

'use strict';

const { transitionOrderStatus } = require('../services/order-status-machine');
const { computeOrderStatus } = require('./parcels');
const log = require('../utils/logger').child({ module: 'orderParcelLinkRules' });

/**
 * Evaluate link rules between order and its parcels.
 * Now delegates to the status machine for any status changes.
 *
 * @param {string} order_id
 * @param {object} db - pg pool instance
 * @returns {string|null} code de la règle déclenchée, ou null
 */
async function evaluateOrderParcelLinkRules(order_id, db) {
  const { rows: allParcels } = await db.query(
    'SELECT status FROM parcels WHERE order_id = $1',
    [order_id]
  );

  if (!allParcels.length) return null;

  const { rows: orderRows } = await db.query(
    'SELECT id, status FROM orders WHERE id = $1',
    [order_id]
  );
  if (!orderRows.length) return null;
  const order = orderRows[0];

  // Compute the aggregated status from parcels
  const computedStatus = computeOrderStatus(allParcels);

  // ── R1/R3 — Delegate to machine ──────────────────────────────────────
  // The machine handles forward-only transitions.
  if (computedStatus !== order.status) {
    const result = await transitionOrderStatus({
      orderId: order_id,
      newStatus: computedStatus,
      actor: { id: null, role: 'system' },
      source: 'system',
      note: `[linkRules] computed=${computedStatus}`,
    });

    if (result.success && !result.noop) {
      if (computedStatus === 'collected') return 'R1_ALL_COLLECTED';
      return 'R3_STATUS_ADVANCED';
    }
  }

  // ── R2 — All parcels cancelled (observation signal) ───────────────────
  if (allParcels.every(p => p.status === 'cancelled') && order.status !== 'collected') {
    log.info(`[LINK-RULES] R2: All parcels cancelled for order ${order_id}`);
    return 'R2_ALL_PARCELS_CANCELLED';
  }

  return null;
}

module.exports = { evaluateOrderParcelLinkRules };
