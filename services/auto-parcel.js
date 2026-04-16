/**
 * KOMERCE — Auto-Parcel Distribution Engine
 *
 * Le système répartit automatiquement les articles dans les colis.
 * L'agent voit la répartition et peut ajuster sans bloquer le flux.
 *
 * Logique :
 *   1. Trouver les commandes 'ordered' sans colis assigné
 *   2. Grouper par destination (île + relais)
 *   3. Créer ou réutiliser un colis ouvert par destination
 *   4. Assigner les articles via parcel_items
 *   5. L'agent peut réassigner entre colis sans friction
 *
 * Appelé automatiquement :
 *   - Quand une commande passe à 'ordered' (via state machine hook)
 *   - Manuellement via POST /api/hub/auto-distribute
 */

'use strict';

const db = require('../db');
const { generateParcelRef } = require('../utils/reference');

// ── Config ──────────────────────────────────────────────────────
const MAX_ITEMS_PER_PARCEL = 30;
const MAX_ORDERS_PER_PARCEL = 10;

// ── Core: distribute one order ──────────────────────────────────
/**
 * Auto-assign an order's items to a parcel.
 * Reuses existing open parcel for same destination, or creates a new one.
 */
async function distributeOrder(orderId, dbClient) {
  const client = dbClient || db;

  // Get order details
  const { rows: [order] } = await client.query(`
    SELECT o.id, o.reference, o.status, o.destination_island,
           o.relais_id, o.user_id, o.total_kmf,
           u.full_name AS customer_name, u.phone AS customer_phone,
           r.name AS relais_name, r.island AS relais_island
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN relais r ON r.id = o.relais_id
    WHERE o.id = $1
  `, [orderId]);

  if (!order) return { success: false, error: 'Order not found' };

  // Check if order already has items in parcels
  const { rows: existingItems } = await client.query(`
    SELECT pi.id FROM parcel_items pi
    JOIN order_items oi ON oi.id = pi.order_item_id
    JOIN parcels p ON p.id = pi.parcel_id AND p.status != 'cancelled'
    WHERE oi.order_id = $1
    LIMIT 1
  `, [orderId]);

  if (existingItems.length > 0) {
    return { success: true, already_assigned: true, order_ref: order.reference };
  }

  // Get order items
  const { rows: items } = await client.query(
    'SELECT id, quantity, product_id FROM order_items WHERE order_id = $1',
    [orderId]
  );
  if (items.length === 0) return { success: false, error: 'No items in order' };

  const totalQty = items.reduce((s, i) => s + (i.quantity || 1), 0);
  const destIsland = (order.destination_island || order.relais_island || 'unknown').toUpperCase();

  // Find an open parcel for the same destination with room
  const { rows: openParcels } = await client.query(`
    SELECT p.id, p.reference, p.destination_island,
           COALESCE(agg.item_count, 0)::int AS item_count,
           COALESCE(agg.order_count, 0)::int AS order_count
    FROM parcels p
    LEFT JOIN LATERAL (
      SELECT COUNT(pi.id) AS item_count,
             COUNT(DISTINCT oi.order_id) AS order_count
      FROM parcel_items pi
      JOIN order_items oi ON oi.id = pi.order_item_id
      WHERE pi.parcel_id = p.id
    ) agg ON true
    WHERE p.status IN ('draft', 'preparation')
      AND UPPER(COALESCE(p.destination_island, '')) = $1
    ORDER BY p.created_at ASC
  `, [destIsland]);

  let parcelId, parcelRef, created = false;

  // Find a parcel with room
  const suitable = openParcels.find(p =>
    p.item_count + totalQty <= MAX_ITEMS_PER_PARCEL &&
    p.order_count < MAX_ORDERS_PER_PARCEL
  );

  if (suitable) {
    parcelId = suitable.id;
    parcelRef = suitable.reference;
  } else {
    // Create new parcel
    const ref = await generateParcelRef(client);
    
    // Try with destination_island column
    try {
      const { rows: [newP] } = await client.query(`
        INSERT INTO parcels (reference, destination_island, status, type, recipient_name, recipient_phone)
        VALUES ($1, $2, 'preparation', 'standard', $3, $4)
        RETURNING id, reference
      `, [ref, destIsland, order.customer_name, order.customer_phone]);
      parcelId = newP.id;
      parcelRef = newP.reference;
    } catch (e) {
      // Fallback: use order_id (1:1) if destination_island column doesn't exist
      const { rows: [newP] } = await client.query(`
        INSERT INTO parcels (reference, order_id, status, type)
        VALUES ($1, $2, 'preparation', 'standard')
        RETURNING id, reference
      `, [ref, orderId]);
      parcelId = newP.id;
      parcelRef = newP.reference;
    }
    created = true;
  }

  // Assign items
  let assigned = 0;
  for (const item of items) {
    try {
      await client.query(`
        INSERT INTO parcel_items (parcel_id, order_item_id, quantity, product_name)
        SELECT $1, $2, $3, COALESCE(p.name, 'Produit')
        FROM order_items oi
        LEFT JOIN products p ON p.id = oi.product_id
        WHERE oi.id = $2
        ON CONFLICT DO NOTHING
      `, [parcelId, item.id, item.quantity || 1]);
      assigned++;
    } catch (e) {
      // product_name column might not exist
      try {
        await client.query(`
          INSERT INTO parcel_items (parcel_id, order_item_id, quantity)
          VALUES ($1, $2, $3)
          ON CONFLICT DO NOTHING
        `, [parcelId, item.id, item.quantity || 1]);
        assigned++;
      } catch (e2) {
        console.warn(`[AUTO-PARCEL] Failed to assign item ${item.id}: ${e2.message}`);
      }
    }
  }

  console.log(`[AUTO-PARCEL] ${order.reference} → ${parcelRef} (${assigned} items, ${created ? 'new' : 'existing'} parcel)`);

  return {
    success: true,
    order_ref: order.reference,
    parcel_ref: parcelRef,
    parcel_id: parcelId,
    items_assigned: assigned,
    parcel_created: created,
    destination: destIsland
  };
}


// ── Batch: distribute all unassigned ordered orders ─────────────
async function distributeAll() {
  // Find all ordered orders without any parcel assignment
  const { rows: unassigned } = await db.query(`
    SELECT o.id, o.reference
    FROM orders o
    WHERE o.status IN ('ordered', 'preparation')
      AND NOT EXISTS (
        SELECT 1 FROM parcel_items pi
        JOIN order_items oi ON oi.id = pi.order_item_id
        JOIN parcels p ON p.id = pi.parcel_id AND p.status != 'cancelled'
        WHERE oi.order_id = o.id
      )
      AND EXISTS (
        SELECT 1 FROM order_items oi WHERE oi.order_id = o.id
      )
    ORDER BY o.created_at ASC
  `);

  const results = [];
  for (const order of unassigned) {
    try {
      const r = await distributeOrder(order.id);
      results.push(r);
    } catch (e) {
      results.push({ success: false, order_ref: order.reference, error: e.message });
    }
  }

  // Also get current distribution summary
  const { rows: summary } = await db.query(`
    SELECT
      p.id AS parcel_id, p.reference AS parcel_ref, p.status AS parcel_status,
      UPPER(COALESCE(p.destination_island, '')) AS destination,
      p.created_at AS parcel_created,
      COUNT(DISTINCT oi.order_id)::int AS orders_count,
      COUNT(pi.id)::int AS items_count,
      SUM(COALESCE(oi.quantity, 1))::int AS total_qty,
      COALESCE(SUM(DISTINCT sub_o.total_kmf), 0)::int AS total_kmf,
      json_agg(DISTINCT jsonb_build_object(
        'ref', sub_o.reference,
        'customer', sub_u.full_name,
        'items', (SELECT COUNT(*) FROM order_items x WHERE x.order_id = sub_o.id),
        'total', sub_o.total_kmf
      )) AS orders
    FROM parcels p
    JOIN parcel_items pi ON pi.parcel_id = p.id
    JOIN order_items oi ON oi.id = pi.order_item_id
    JOIN orders sub_o ON sub_o.id = oi.order_id
    LEFT JOIN users sub_u ON sub_u.id = sub_o.user_id
    WHERE p.status IN ('draft', 'preparation')
    GROUP BY p.id
    ORDER BY p.destination_island, p.created_at
  `);

  return {
    distributed: results.filter(r => r.success && !r.already_assigned).length,
    already_assigned: results.filter(r => r.already_assigned).length,
    errors: results.filter(r => !r.success).length,
    details: results,
    parcels: summary
  };
}


// ── Get distribution overview (for dashboard) ───────────────────
async function getDistribution() {
  // Open parcels with their orders
  const { rows: parcels } = await db.query(`
    SELECT
      p.id, p.reference, p.status,
      UPPER(COALESCE(p.destination_island, '')) AS destination,
      p.created_at,
      COALESCE(agg.orders_count, 0)::int AS orders_count,
      COALESCE(agg.items_count, 0)::int AS items_count,
      COALESCE(agg.total_qty, 0)::int AS total_qty,
      COALESCE(agg.total_kmf, 0)::int AS total_kmf,
      COALESCE(agg.orders_json, '[]'::json) AS orders
    FROM parcels p
    LEFT JOIN LATERAL (
      SELECT
        COUNT(DISTINCT oi.order_id) AS orders_count,
        COUNT(pi.id) AS items_count,
        SUM(COALESCE(oi.quantity, 1)) AS total_qty,
        COALESCE(SUM(DISTINCT sub_o.total_kmf), 0) AS total_kmf,
        json_agg(DISTINCT jsonb_build_object(
          'id', sub_o.id,
          'ref', sub_o.reference,
          'customer', sub_u.full_name,
          'status', sub_o.status,
          'items_count', (SELECT COUNT(*) FROM order_items x WHERE x.order_id = sub_o.id),
          'total_kmf', sub_o.total_kmf
        )) AS orders_json
      FROM parcel_items pi
      JOIN order_items oi ON oi.id = pi.order_item_id
      JOIN orders sub_o ON sub_o.id = oi.order_id
      LEFT JOIN users sub_u ON sub_u.id = sub_o.user_id
      WHERE pi.parcel_id = p.id
    ) agg ON true
    WHERE p.status IN ('draft', 'preparation')
    ORDER BY p.destination_island, p.created_at
  `);

  // Unassigned orders
  const { rows: unassigned } = await db.query(`
    SELECT o.id, o.reference, o.status, o.destination_island,
           o.total_kmf, o.created_at,
           u.full_name AS customer_name,
           (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS items_count
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    WHERE o.status IN ('ordered', 'preparation')
      AND NOT EXISTS (
        SELECT 1 FROM parcel_items pi
        JOIN order_items oi ON oi.id = pi.order_item_id
        JOIN parcels p ON p.id = pi.parcel_id AND p.status != 'cancelled'
        WHERE oi.order_id = o.id
      )
    ORDER BY o.created_at ASC
  `);

  return { parcels, unassigned };
}


// ── Reassign order to different parcel ──────────────────────────
async function reassignOrder(orderId, targetParcelId) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Get order items
    const { rows: items } = await client.query(
      'SELECT id, quantity FROM order_items WHERE order_id = $1', [orderId]
    );

    // Remove from current parcels
    for (const item of items) {
      await client.query(
        'DELETE FROM parcel_items WHERE order_item_id = $1', [item.id]
      );
    }

    // Assign to target parcel
    for (const item of items) {
      await client.query(`
        INSERT INTO parcel_items (parcel_id, order_item_id, quantity)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
      `, [targetParcelId, item.id, item.quantity || 1]);
    }

    await client.query('COMMIT');
    return { success: true };
  } catch (e) {
    await client.query('ROLLBACK');
    return { success: false, error: e.message };
  } finally {
    client.release();
  }
}


module.exports = {
  distributeOrder,
  distributeAll,
  getDistribution,
  reassignOrder,
  MAX_ITEMS_PER_PARCEL,
  MAX_ORDERS_PER_PARCEL,
};
