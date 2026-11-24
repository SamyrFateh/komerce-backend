/** @komerce-arch
 * @role          n27-remnant-cancellation-context
 * @domain        refunds
 * @layer         service
 * @criticality   critical
 * @inputs        admin actor, order reference, verified shortage facts
 * @outputs       read-only item/phase context and local refund liability reservation
 * @depends       db, item-refund-reservation-service, local-item-refund-reservation
 * @used-by       routes/admin/orders.js
 * @db-read       orders, order_items, purchase_lines, purchase_orders, parcels, parcel_items, incidents, international_shipment_relay_receipts
 * @db-write      local_item_refund_reservations
 * @db-txn        local reservation delegates to its owner service
 * @doctrine      collected_units_excluded, open_supplier_or_transport_blocks, no_wallet_credit
 * @impact-areas  refunds, purchasing, logistics, admin-dashboard
 * @version       2026-11
 */
'use strict';

const dbDefault = require('../db');
const { readVerifiedShortageCandidates } = require('./item-refund-reservation-service');
const { reserveLocalShortage } = require('./local-item-refund-reservation');

async function readN27RemnantContext({ orderReference, actor, db = dbDefault }) {
  const base = await readVerifiedShortageCandidates({
    orderReference, actor, db, allowLocal: true,
  });
  const { rows: phases } = await db.query(
    `SELECT oi.id AS order_item_id,
       EXISTS (
         SELECT 1 FROM v_purchase_line_progress v
          WHERE v.order_item_id=oi.id AND NOT v.cancelled
            AND v.received_quantity < v.effective_quantity
            AND v.po_status IN ('notified','confirmed','partially_received')
       ) AS supplier_pending,
       EXISTS (
         SELECT 1 FROM parcel_items pi
         JOIN parcels p ON p.id=pi.parcel_id
          WHERE pi.order_item_id=oi.id AND p.status IN
            ('preparation','shipped','in_transit','arrived','available')
       ) AS transport_pending
      FROM order_items oi WHERE oi.order_id=$1::uuid`, [base.order.id]
  );
  const byItem = new Map(phases.map(row => [String(row.order_item_id), row]));
  const phaseOf = itemId => {
    const row = byItem.get(String(itemId));
    if (!row) return { phase: 'UNKNOWN', blocked_reason: 'phase_unresolved' };
    if (row?.transport_pending) return { phase: 'F3', blocked_reason: 'transport_pending' };
    if (row?.supplier_pending) return { phase: 'F2', blocked_reason: 'supplier_commitment_pending' };
    return { phase: 'F1', blocked_reason: null };
  };
  const items = base.items.map(item => ({
    ...item,
    ...phaseOf(item.id),
    uncollected_quantity: Math.max(0, item.quantity - item.qty_collected - item.qty_refunded),
  }));
  const candidates = base.candidates.map(candidate => ({
    ...candidate,
    ...phaseOf(candidate.order_item_id),
    available_quantity: phaseOf(candidate.order_item_id).blocked_reason
      ? 0 : candidate.available_quantity,
  }));
  return {
    ...base,
    items,
    candidates: candidates.filter(candidate => candidate.available_quantity > 0),
    blocked: base.blocked || !['cash_relais', 'mobile_money'].includes(base.order.payment_mode),
  };
}

async function reserveN27Remnant({ orderId, orderItemId, incidentId, operationKey,
  quantity, reason, actor, db = dbDefault }) {
  if (actor?.role !== 'admin') {
    const error = new Error('Décision financière N27 réservée admin');
    error.status = 403; error.code = 'N27_ADMIN_REQUIRED'; throw error;
  }
  return reserveLocalShortage({
    orderId, orderItemId, incidentId, operationKey, quantity,
    reason: `N27 — ${String(reason || '').trim()}`, actor,
    requireReleasedSupply: true, db,
  });
}

module.exports = { readN27RemnantContext, reserveN27Remnant };
