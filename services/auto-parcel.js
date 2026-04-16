/**
 * KOMERCE — Auto-Parcel Distribution Engine v2
 *
 * Règles de consolidation :
 *   - MAX 3 colis ouverts par destination (configurable)
 *   - MAX 30 articles / 10 commandes par colis
 *   - Quand tous les colis sont pleins → commande en file d'attente
 *   - Signal "Expédiez les colis en cours" quand saturé
 *   - Ne crée PAS de colis à l'infini
 */

'use strict';

const db = require('../db');
const { generateParcelRef } = require('../utils/reference');

// ── Config ──────────────────────────────────────────────────────
const MAX_ITEMS_PER_PARCEL = 30;
const MAX_ORDERS_PER_PARCEL = 10;
const MAX_OPEN_PARCELS_PER_DEST = 3;

// ── Core: distribute one order ──────────────────────────────────
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

  // Check if order already assigned
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

  // Find open parcels for this destination
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

  // Try to find a parcel with room
  const suitable = openParcels.find(p =>
    p.item_count + totalQty <= MAX_ITEMS_PER_PARCEL &&
    p.order_count < MAX_ORDERS_PER_PARCEL
  );

  let parcelId, parcelRef, created = false;

  if (suitable) {
    // ✅ Reuse existing parcel
    parcelId = suitable.id;
    parcelRef = suitable.reference;
  } else if (openParcels.length < MAX_OPEN_PARCELS_PER_DEST) {
    // ✅ Create new parcel (under the limit)
    const ref = await generateParcelRef(client);
    try {
      const { rows: [newP] } = await client.query(`
        INSERT INTO parcels (reference, destination_island, status, type, recipient_name, recipient_phone)
        VALUES ($1, $2, 'preparation', 'standard', $3, $4)
        RETURNING id, reference
      `, [ref, destIsland, order.customer_name, order.customer_phone]);
      parcelId = newP.id;
      parcelRef = newP.reference;
    } catch (e) {
      const { rows: [newP] } = await client.query(`
        INSERT INTO parcels (reference, order_id, status, type)
        VALUES ($1, $2, 'preparation', 'standard')
        RETURNING id, reference
      `, [ref, orderId]);
      parcelId = newP.id;
      parcelRef = newP.reference;
    }
    created = true;
    console.log(`[AUTO-PARCEL] New parcel ${parcelRef} for ${destIsland} (${openParcels.length + 1}/${MAX_OPEN_PARCELS_PER_DEST})`);
  } else {
    // 🚫 LIMIT REACHED — don't create more, queue the order
    console.log(`[AUTO-PARCEL] ⚠️ ${destIsland}: ${openParcels.length} colis ouverts (max ${MAX_OPEN_PARCELS_PER_DEST}) — ${order.reference} en file d'attente`);
    return {
      success: true,
      queued: true,
      order_ref: order.reference,
      destination: destIsland,
      reason: `${openParcels.length} colis ouverts vers ${destIsland} (max ${MAX_OPEN_PARCELS_PER_DEST}). Expédiez les colis en cours.`,
      open_parcels: openParcels.map(p => ({
        ref: p.reference,
        items: p.item_count,
        orders: p.order_count,
        full: p.item_count >= MAX_ITEMS_PER_PARCEL || p.order_count >= MAX_ORDERS_PER_PARCEL
      }))
    };
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


// ── Batch: distribute all unassigned ────────────────────────────
async function distributeAll() {
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

  // Distribution summary
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
    distributed: results.filter(r => r.success && !r.already_assigned && !r.queued).length,
    queued: results.filter(r => r.queued).length,
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

  // Unassigned orders (including queued due to parcel limit)
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

  // Saturation info per destination
  const destCounts = {};
  for (const p of parcels) {
    const d = p.destination || 'UNKNOWN';
    if (!destCounts[d]) destCounts[d] = { open: 0, full: 0 };
    destCounts[d].open++;
    if (p.items_count >= MAX_ITEMS_PER_PARCEL || p.orders_count >= MAX_ORDERS_PER_PARCEL) {
      destCounts[d].full++;
    }
  }

  const saturated = [];
  for (const [dest, counts] of Object.entries(destCounts)) {
    if (counts.open >= MAX_OPEN_PARCELS_PER_DEST) {
      const queued = unassigned.filter(o =>
        (o.destination_island || '').toUpperCase() === dest
      ).length;
      if (queued > 0) {
        saturated.push({
          destination: dest,
          open_parcels: counts.open,
          full_parcels: counts.full,
          queued_orders: queued,
          message: `🚨 ${dest}: ${counts.open} colis ouverts (max ${MAX_OPEN_PARCELS_PER_DEST}), ${queued} commande(s) en attente. Expédiez !`
        });
      }
    }
  }

  return {
    parcels,
    unassigned,
    saturated,
    limits: { MAX_ITEMS_PER_PARCEL, MAX_ORDERS_PER_PARCEL, MAX_OPEN_PARCELS_PER_DEST }
  };
}


// ── Reassign order to different parcel ──────────────────────────
async function reassignOrder(orderId, targetParcelId) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows: items } = await client.query(
      'SELECT id, quantity FROM order_items WHERE order_id = $1', [orderId]
    );
    for (const item of items) {
      await client.query('DELETE FROM parcel_items WHERE order_item_id = $1', [item.id]);
    }
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
  MAX_OPEN_PARCELS_PER_DEST,
};
