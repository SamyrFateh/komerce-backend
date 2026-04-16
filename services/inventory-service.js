/**
 * ═══════════════════════════════════════════════════════════════
 * INVENTORY SERVICE — Hub article management
 * ═══════════════════════════════════════════════════════════════
 *
 * Manages individual articles received at the Hub:
 *   - Receive articles from sourcing
 *   - Assign to parcels (smart matching)
 *   - Buffer management (when no compatible parcel)
 *   - Order completion tracking
 *   - Dispatch decision logic
 *
 * ⚠️ ENRICHMENT ONLY — does NOT modify existing order_items/parcels tables
 *    Uses new inventory_items table as a tracking layer
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

const db = require('../db');
const { v4: uuidv4 } = require('uuid');

// ════════════════════════════════════════════════════════════════
// 1. RECEIVE ARTICLE
// ════════════════════════════════════════════════════════════════

/**
 * Record an article received at the Hub.
 * Creates an inventory_item linked to the order_item.
 *
 * @param {object} params
 * @param {string} params.order_item_id — UUID of the order_item
 * @param {number} [params.quantity=1] — How many units received
 * @param {string} [params.received_by] — UUID of the hub agent
 * @param {string} [params.notes] — Optional notes
 * @returns {object} The created inventory_item
 */
async function receiveItem({ order_item_id, quantity = 1, received_by = null, notes = null }) {
  // Fetch order_item info
  const { rows: [oi] } = await db.query(
    `SELECT oi.id, oi.order_id, oi.product_id, oi.quantity AS ordered_qty,
            o.destination_island, o.status AS order_status
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE oi.id = $1`,
    [order_item_id]
  );

  if (!oi) throw new Error('order_item introuvable: ' + order_item_id);

  const id = uuidv4();
  const { rows: [item] } = await db.query(`
    INSERT INTO inventory_items (id, order_item_id, order_id, product_id, quantity, status, received_by, notes)
    VALUES ($1, $2, $3, $4, $5, 'received', $6, $7)
    RETURNING *
  `, [id, order_item_id, oi.order_id, oi.product_id, quantity, received_by, notes]);

  // Update order completion
  await updateOrderCompletion(oi.order_id);

  console.log(`[INVENTORY] ✅ Received ${quantity}x item for order_item ${order_item_id}`);
  return item;
}

// ════════════════════════════════════════════════════════════════
// 2. ASSIGN ITEM TO PARCEL
// ════════════════════════════════════════════════════════════════

/**
 * Smart assignment: find a compatible open parcel or suggest buffer.
 *
 * Compatible = same destination_island + parcel in 'draft' or 'preparation' status
 *
 * @param {string} inventoryItemId — UUID of the inventory_item
 * @returns {object} { assigned: boolean, parcel_id?, buffer_reason? }
 */
async function assignItemToParcel(inventoryItemId) {
  const { rows: [item] } = await db.query(
    `SELECT ii.*, o.destination_island, o.id AS order_id
     FROM inventory_items ii
     JOIN orders o ON o.id = ii.order_id
     WHERE ii.id = $1 AND ii.status = 'received'`,
    [inventoryItemId]
  );

  if (!item) throw new Error('Inventory item introuvable ou déjà assigné');

  // Find compatible open parcel (same destination, still in preparation)
  const { rows: [parcel] } = await db.query(`
    SELECT p.id, p.reference
    FROM parcels p
    JOIN orders o ON o.id = p.order_id
    WHERE o.destination_island = $1
      AND p.status IN ('draft', 'preparation')
      AND p.order_id = $2
    ORDER BY p.created_at ASC
    LIMIT 1
  `, [item.destination_island, item.order_id]);

  if (parcel) {
    await db.query(`
      UPDATE inventory_items 
      SET status = 'assigned', parcel_id = $2, assigned_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [inventoryItemId, parcel.id]);

    console.log(`[INVENTORY] ✅ Item ${inventoryItemId} → parcel ${parcel.reference}`);
    return { assigned: true, parcel_id: parcel.id, parcel_ref: parcel.reference };
  }

  // No compatible parcel → buffer
  const bufferUntil = new Date(Date.now() + 12 * 60 * 60 * 1000); // +12h
  await db.query(`
    UPDATE inventory_items 
    SET status = 'buffered', buffer_reason = 'no_compatible_parcel', buffer_until = $2, updated_at = NOW()
    WHERE id = $1
  `, [inventoryItemId, bufferUntil]);

  console.log(`[INVENTORY] ⏳ Item ${inventoryItemId} → buffer (no compatible parcel)`);
  return { assigned: false, buffer_reason: 'no_compatible_parcel', buffer_until: bufferUntil };
}

// ════════════════════════════════════════════════════════════════
// 3. BUFFER MANAGEMENT
// ════════════════════════════════════════════════════════════════

/**
 * Explicitly buffer an item with a reason.
 */
async function bufferItem(inventoryItemId, reason, bufferUntilHours = 12) {
  const bufferUntil = new Date(Date.now() + bufferUntilHours * 60 * 60 * 1000);
  
  await db.query(`
    UPDATE inventory_items 
    SET status = 'buffered', buffer_reason = $2, buffer_until = $3, updated_at = NOW()
    WHERE id = $1
  `, [inventoryItemId, reason, bufferUntil]);

  return { buffered: true, buffer_until: bufferUntil };
}

/**
 * Get all buffered items with details.
 */
async function getBufferItems() {
  const { rows } = await db.query(`
    SELECT ii.*, 
           o.reference AS order_ref, o.destination_island,
           p.name AS product_name,
           u.full_name AS received_by_name,
           EXTRACT(EPOCH FROM (NOW() - ii.received_at)) / 3600 AS hours_in_buffer,
           ii.buffer_until < NOW() AS deadline_passed
    FROM inventory_items ii
    LEFT JOIN orders o ON o.id = ii.order_id
    LEFT JOIN products p ON p.id = ii.product_id
    LEFT JOIN users u ON u.id = ii.received_by
    WHERE ii.status = 'buffered'
    ORDER BY ii.buffer_until ASC
  `);
  return rows;
}

// ════════════════════════════════════════════════════════════════
// 4. ORDER COMPLETION TRACKING
// ════════════════════════════════════════════════════════════════

/**
 * Recalculate completion_ratio for an order based on received inventory.
 */
async function updateOrderCompletion(orderId) {
  const { rows: [stats] } = await db.query(`
    SELECT 
      COALESCE(SUM(oi.quantity), 0)::int AS items_total,
      COALESCE(SUM(LEAST(
        COALESCE((SELECT SUM(ii.quantity) FROM inventory_items ii WHERE ii.order_item_id = oi.id AND ii.status != 'cancelled'), 0),
        oi.quantity
      )), 0)::int AS items_received
    FROM order_items oi
    WHERE oi.order_id = $1
  `, [orderId]);

  const total = stats.items_total || 0;
  const received = stats.items_received || 0;
  const ratio = total > 0 ? Math.min(received / total, 1.0) : 0;

  await db.query(`
    UPDATE orders 
    SET completion_ratio = $2, items_received = $3, items_total = $4, updated_at = NOW()
    WHERE id = $1
  `, [orderId, ratio, received, total]);

  return { orderId, completion_ratio: ratio, items_received: received, items_total: total };
}

// ════════════════════════════════════════════════════════════════
// 5. DISPATCH DECISION
// ════════════════════════════════════════════════════════════════

/**
 * Decide if an order should be dispatched (full or partial).
 *
 * Rules:
 *   - 100% received → dispatch (full)
 *   - deadline_dispatch passed → dispatch (partial)
 *   - buffer pressure (>10 items buffered for same destination) → dispatch (partial)
 *   - Otherwise → wait
 *
 * @param {string} orderId
 * @returns {object} { should_dispatch, reason, completion_ratio }
 */
async function shouldDispatchOrder(orderId) {
  const { rows: [order] } = await db.query(`
    SELECT id, reference, completion_ratio, items_received, items_total, 
           deadline_dispatch, destination_island, status
    FROM orders WHERE id = $1
  `, [orderId]);

  if (!order) throw new Error('Commande introuvable');

  // Rule 1: 100% complete
  if (order.completion_ratio >= 1.0) {
    return { should_dispatch: true, reason: 'complete', completion_ratio: order.completion_ratio };
  }

  // Rule 2: Deadline passed
  if (order.deadline_dispatch && new Date(order.deadline_dispatch) < new Date()) {
    return { should_dispatch: true, reason: 'deadline_passed', completion_ratio: order.completion_ratio };
  }

  // Rule 3: Buffer pressure (>10 items for same destination)
  const { rows: [pressure] } = await db.query(`
    SELECT COUNT(*)::int AS buffered_count
    FROM inventory_items ii
    JOIN orders o ON o.id = ii.order_id
    WHERE o.destination_island = $1 AND ii.status = 'buffered'
  `, [order.destination_island]);

  if (pressure.buffered_count > 10) {
    return { should_dispatch: true, reason: 'buffer_pressure', completion_ratio: order.completion_ratio, buffered_count: pressure.buffered_count };
  }

  return { should_dispatch: false, reason: 'waiting', completion_ratio: order.completion_ratio };
}

// ════════════════════════════════════════════════════════════════
// 6. HUB STATS / KPI
// ════════════════════════════════════════════════════════════════

/**
 * Get Hub KPIs: buffer items, avg buffer time, open parcels, partial rate.
 */
async function getHubStats() {
  const { rows: [stats] } = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM inventory_items WHERE status = 'received') AS items_received,
      (SELECT COUNT(*)::int FROM inventory_items WHERE status = 'assigned') AS items_assigned,
      (SELECT COUNT(*)::int FROM inventory_items WHERE status = 'buffered') AS items_buffered,
      (SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - received_at)) / 3600), 0)::numeric(10,1)
       FROM inventory_items WHERE status = 'buffered') AS avg_buffer_hours,
      (SELECT COUNT(*)::int FROM parcels WHERE status IN ('draft', 'preparation')) AS open_parcels,
      (SELECT COUNT(*)::int FROM orders 
       WHERE completion_ratio > 0 AND completion_ratio < 1 
         AND status NOT IN ('cancelled', 'refunded', 'collected')) AS partial_orders,
      (SELECT COUNT(*)::int FROM inventory_items 
       WHERE status = 'buffered' AND buffer_until < NOW()) AS overdue_buffer
  `);
  return stats;
}

module.exports = {
  receiveItem,
  assignItemToParcel,
  bufferItem,
  getBufferItems,
  updateOrderCompletion,
  shouldDispatchOrder,
  getHubStats,
};
