/**
 * @komerce-arch
 * @role          inventory-inventory-service
 * @domain        inventory
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/parcel-item-mutation-service.js
 * @used-by       bootstrap/crons.js, routes/inventory-api.js
 * @db-read       inventory_items, order_items, orders, parcel_items, parcels, products
 * @db-write      inventory_items, orders
 * @db-write-via:parcel-item-mutation-service parcel_items
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  inventory
 * @version       2026-06
 */


'use strict';
/**
 * ═══════════════════════════════════════════════════════════════
 * INVENTORY SERVICE v3 — Proposals as GUIDANCE, scan-driven
 * 
 * Philosophy:
 *   - Motor PROPOSES assignments (visual guide)
 *   - Agent SCANS items into parcels (action)
 *   - System ADAPTS: match proposal → ✅, different parcel → auto-reassign
 *   - No explicit confirm/reject — just scan and go
 * ═══════════════════════════════════════════════════════════════
 */
const db = require('../db');
const {
  assignSingleOrderItemToParcel,
} = require('./parcel-item-mutation-service');

const BUFFER_DEFAULT_HOURS = 12;

// ─── RECEIVE ARTICLE ──────────────────────────────────────────
async function receiveItem({ order_item_id, order_id }) {
  // Verify order_item exists
  const { rows: [oi] } = await db.query(
    `SELECT oi.id, oi.order_id, oi.product_id, oi.quantity, p.name AS product_name
     FROM order_items oi JOIN products p ON p.id = oi.product_id
     WHERE oi.id = $1`, [order_item_id]
  );
  if (!oi) throw new Error('Article introuvable');

  const effectiveOrderId = order_id || oi.order_id;

  // Create inventory_item
  const { rows: [inv] } = await db.query(`
    INSERT INTO inventory_items (id, order_item_id, order_id, status, received_at)
    VALUES (gen_random_uuid(), $1, $2, 'received', NOW())
    RETURNING *
  `, [order_item_id, effectiveOrderId]);

  // Auto-propose
  const proposal = await proposeAssignment(inv.id);

  // Update order completion
  await updateOrderCompletion(effectiveOrderId);

  return { item: inv, proposal };
}

// ─── PROPOSE ASSIGNMENT (guidance, not a gate) ────────────────
async function proposeAssignment(inventoryItemId) {
  const { rows: [item] } = await db.query(
    `SELECT ii.*, o.destination_island, o.id AS order_id
     FROM inventory_items ii
     JOIN orders o ON o.id = ii.order_id
     WHERE ii.id = $1 AND ii.status IN ('received', 'buffered')`,
    [inventoryItemId]
  );

  if (!item) return null; // already assigned or proposed — fine

  // Find open parcels: same order first, then same destination
  const { rows: parcels } = await db.query(`
    SELECT p.id, p.reference, p.order_id,
           CASE WHEN p.order_id = $2 THEN 0 ELSE 1 END AS priority,
           (SELECT COUNT(*)::int FROM parcel_items pi WHERE pi.parcel_id = p.id) AS item_count
    FROM parcels p
    JOIN orders o ON o.id = p.order_id
    WHERE o.destination_island = $1
      AND p.status IN ('draft', 'preparation')
    ORDER BY priority ASC, item_count ASC, p.created_at ASC
    LIMIT 5
  `, [item.destination_island, item.order_id]);

  if (parcels.length > 0) {
    const best = parcels[0];
    await db.query(`
      UPDATE inventory_items 
      SET status = 'proposed', proposed_parcel_id = $2, proposed_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [inventoryItemId, best.id]);

    return { status: 'proposed', parcel_id: best.id, parcel_ref: best.reference, alternatives: parcels.slice(1) };
  }

  // No compatible parcel → buffer
  const bufferUntil = new Date(Date.now() + BUFFER_DEFAULT_HOURS * 3600000);
  await db.query(`
    UPDATE inventory_items 
    SET status = 'buffered', buffer_reason = 'no_compatible_parcel', buffer_until = $2, updated_at = NOW()
    WHERE id = $1
  `, [inventoryItemId, bufferUntil]);

  return { status: 'buffered', reason: 'no_compatible_parcel', buffer_until: bufferUntil };
}

// ─── SCAN INTO PARCEL (the real action) ───────────────────────
// Agent scans item into a parcel. System adapts:
//   - matches proposal → great
//   - different parcel → auto-reassign, no friction
//   - no proposal yet → assign directly
async function scanIntoParcel(inventoryItemId, parcelId) {
  const { rows: [item] } = await db.query(
    `SELECT * FROM inventory_items WHERE id = $1 AND status IN ('received', 'proposed', 'buffered')`,
    [inventoryItemId]
  );
  if (!item) throw new Error('Item introuvable ou déjà assigné');

  const { rows: [parcel] } = await db.query(
    `SELECT id, reference, status FROM parcels WHERE id = $1`,
    [parcelId]
  );
  if (!parcel) throw new Error('Colis introuvable');

  const matched = item.proposed_parcel_id === parcelId;

  // Assign
  await db.query(`
    UPDATE inventory_items 
    SET status = 'assigned', parcel_id = $2, proposed_parcel_id = NULL, 
        assigned_at = NOW(), updated_at = NOW()
    WHERE id = $1
  `, [inventoryItemId, parcelId]);

  // Also add to parcel_items if not already there
  await assignSingleOrderItemToParcel(db, {
    parcelId,
    orderItemId: item.order_item_id,
  });

  // Update order completion
  await updateOrderCompletion(item.order_id);

  return { 
    assigned: true, 
    matched_proposal: matched, 
    parcel_ref: parcel.reference,
    message: matched ? '✅ Conforme à la proposition' : '🔄 Réassigné (proposition ignorée)'
  };
}

// ─── BULK PROPOSE ALL ─────────────────────────────────────────
async function proposeAll() {
  const { rows: items } = await db.query(
    `SELECT id FROM inventory_items WHERE status IN ('received', 'buffered') ORDER BY received_at ASC`
  );
  const results = { proposed: 0, buffered: 0, errors: 0 };
  for (const item of items) {
    try {
      const r = await proposeAssignment(item.id);
      if (r?.status === 'proposed') results.proposed++;
      else results.buffered++;
    } catch { results.errors++; }
  }
  return results;
}

// ─── ORDER COMPLETION ─────────────────────────────────────────
async function updateOrderCompletion(orderId) {
  const { rows: [counts] } = await db.query(`
    SELECT 
      (SELECT COUNT(*)::int FROM order_items WHERE order_id = $1) AS total,
      (SELECT COUNT(*)::int FROM inventory_items WHERE order_id = $1 AND status != 'cancelled') AS received,
      (SELECT COUNT(*)::int FROM inventory_items WHERE order_id = $1 AND status = 'assigned') AS assigned
    FROM orders WHERE id = $1
  `, [orderId]);

  if (!counts) return;

  const ratio = counts.total > 0 ? counts.received / counts.total : 0;
  await db.query(`
    UPDATE orders SET items_received = $2, items_total = $3, completion_ratio = $4, updated_at = NOW()
    WHERE id = $1
  `, [orderId, counts.received, counts.total, ratio]);

  return { total: counts.total, received: counts.received, assigned: counts.assigned, ratio };
}

// ─── DISPATCH DECISION ────────────────────────────────────────
async function shouldDispatch(orderId) {
  const { rows: [order] } = await db.query(
    `SELECT *, completion_ratio, items_received, items_total, deadline_dispatch FROM orders WHERE id = $1`,
    [orderId]
  );
  if (!order) throw new Error('Commande introuvable');

  const ratio = order.completion_ratio || 0;
  const deadlinePassed = order.deadline_dispatch && new Date(order.deadline_dispatch) < new Date();

  if (ratio >= 1) return { decision: 'dispatch_full', reason: '100% articles reçus', ratio };
  if (deadlinePassed && ratio >= 0.5) return { decision: 'dispatch_partial', reason: `Deadline dépassée (${Math.round(ratio*100)}%)`, ratio };
  if (deadlinePassed && ratio < 0.5) return { decision: 'wait_or_cancel', reason: `Deadline dépassée mais seulement ${Math.round(ratio*100)}%`, ratio };
  return { decision: 'wait', reason: `${Math.round(ratio*100)}% reçu — attente`, ratio };
}

// ─── STATS / KPI ──────────────────────────────────────────────
async function getStats() {
  const { rows: [s] } = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'received')::int AS received,
      COUNT(*) FILTER (WHERE status = 'proposed')::int AS proposed,
      COUNT(*) FILTER (WHERE status = 'assigned')::int AS assigned,
      COUNT(*) FILTER (WHERE status = 'buffered')::int AS buffered,
      COUNT(*) FILTER (WHERE status = 'buffered' AND buffer_until < NOW())::int AS overdue,
      ROUND(EXTRACT(EPOCH FROM AVG(
        CASE WHEN status = 'assigned' THEN assigned_at - received_at END
      ))/60)::int AS avg_assign_minutes
    FROM inventory_items
  `);
  
  const { rows: [p] } = await db.query(`
    SELECT 
      COUNT(*) FILTER (WHERE status IN ('draft','preparation'))::int AS open_parcels,
      COUNT(*) FILTER (WHERE status = 'shipped')::int AS shipped_parcels
    FROM parcels
  `);

  return { ...s, ...p };
}

// ─── LIST ITEMS WITH PROPOSALS ────────────────────────────────
async function listProposals() {
  const { rows } = await db.query(`
    SELECT ii.*, 
           p.name AS product_name,
           o.reference AS order_ref, o.destination_island,
           pcl.reference AS proposed_parcel_ref,
           EXTRACT(EPOCH FROM (NOW() - ii.received_at))/60 AS wait_minutes
    FROM inventory_items ii
    JOIN order_items oi ON oi.id = ii.order_item_id
    JOIN products p ON p.id = oi.product_id
    JOIN orders o ON o.id = ii.order_id
    LEFT JOIN parcels pcl ON pcl.id = ii.proposed_parcel_id
    WHERE ii.status IN ('received', 'proposed', 'buffered')
    ORDER BY 
      CASE ii.status WHEN 'buffered' THEN 0 WHEN 'received' THEN 1 WHEN 'proposed' THEN 2 END,
      ii.received_at ASC
  `);
  return rows;
}

// ─── LIST OPEN PARCELS (for reassign dropdown) ───────────────
async function listOpenParcels() {
  const { rows } = await db.query(`
    SELECT p.id, p.reference, p.status, o.destination_island, o.reference AS order_ref,
           (SELECT COUNT(*)::int FROM parcel_items pi WHERE pi.parcel_id = p.id) AS item_count
    FROM parcels p
    JOIN orders o ON o.id = p.order_id
    WHERE p.status IN ('draft', 'preparation')
    ORDER BY p.created_at DESC
  `);
  return rows;
}

module.exports = {
  receiveItem,
  proposeAssignment,
  proposeAll,
  scanIntoParcel,
  updateOrderCompletion,
  shouldDispatch,
  getStats,
  listProposals,
  listOpenParcels,
  BUFFER_DEFAULT_HOURS
};
