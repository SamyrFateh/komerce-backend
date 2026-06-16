/**
 * @komerce-arch
 * @role          logistics-auto-parcel
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
 * @db-read       LATERAL, existing, order_items, orders, parcel_items, parcels, relais, users
 * @db-write      parcel_items, parcels
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-06
 */

/**
 * KOMERCE — Auto-Parcel Distribution Engine v3 (FIXED)
 *
 * Grouping by relais_id (reliable FK) instead of destination_island text.
 * Uses actual existing parcel columns only.
 *
 * Rules:
 *   - MAX 3 open parcels per relay
 *   - MAX 30 articles / 10 orders per parcel
 *   - Queued orders when saturated
 *   - Cleanup endpoint for ghost parcels
 */

'use strict';

const db = require('../db');
const log = require('../utils/logger').child({ module: 'auto-parcel' });

// ── Config ──────────────────────────────────────────────────────
const MAX_ITEMS_PER_PARCEL = 30;
const MAX_ORDERS_PER_PARCEL = 10;
const MAX_OPEN_PARCELS_PER_DEST = 3;

// ── Generate parcel reference ───────────────────────────────────
async function nextParcelRef(client) {
  const c = client || db;
  // Find the max numeric suffix from existing refs
  const { rows } = await c.query(`
    SELECT reference FROM parcels
    WHERE reference LIKE 'KOM-P-%'
    ORDER BY reference DESC LIMIT 1
  `);
  let next = 1;
  if (rows.length > 0) {
    const match = rows[0].reference.match(/KOM-P-\d+-(\d+)/);
    if (match) next = parseInt(match[1], 10) + 1;
  }
  const year = new Date().getFullYear();
  return `KOM-P-${year}-${String(next).padStart(6, '0')}`;
}

// ── Core: distribute one order ──────────────────────────────────
async function distributeOrder(orderId, dbClient) {
  const client = dbClient || db;

  // Get order + relais info
  const { rows: [order] } = await client.query(`
    SELECT o.id, o.reference, o.status, o.relais_id, o.total_kmf,
           u.full_name AS customer_name, u.phone AS customer_phone,
           r.name AS relais_name, r.island AS relais_island
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN relais r ON r.id = o.relais_id
    WHERE o.id = $1
  `, [orderId]);

  if (!order) return { success: false, error: 'Order not found' };

  // Check if order already has items in active parcels
  const { rows: existingItems } = await client.query(`
    SELECT pi.id FROM parcel_items pi
    JOIN order_items oi ON oi.id = pi.order_item_id
    JOIN parcels p ON p.id = pi.parcel_id AND p.status NOT IN ('cancelled')
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
  const relaisId = order.relais_id;
  const destLabel = (order.relais_island || 'inconnue').toUpperCase();

  // Find open parcels for same relais (or same island if no relais)
  let openQuery, openParams;
  if (relaisId) {
    openQuery = `
      SELECT p.id, p.reference,
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
        AND p.relais_id = $1
      ORDER BY p.created_at ASC
    `;
    openParams = [relaisId];
  } else {
    openQuery = `
      SELECT p.id, p.reference,
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
        AND p.order_id = $1
      ORDER BY p.created_at ASC
    `;
    openParams = [orderId];
  }

  const { rows: openParcels } = await client.query(openQuery, openParams);

  // Try to find parcel with room
  const suitable = openParcels.find(p =>
    p.item_count + totalQty <= MAX_ITEMS_PER_PARCEL &&
    p.order_count < MAX_ORDERS_PER_PARCEL
  );

  let parcelId, parcelRef, created = false;

  if (suitable) {
    parcelId = suitable.id;
    parcelRef = suitable.reference;
  } else if (openParcels.length < MAX_OPEN_PARCELS_PER_DEST) {
    // Create new parcel — using ONLY columns that exist
    const ref = await nextParcelRef(client);
    const { rows: [newP] } = await client.query(`
      INSERT INTO parcels (reference, order_id, relais_id, status, type, label)
      VALUES ($1, $2, $3, 'preparation', 'standard', $4)
      RETURNING id, reference
    `, [ref, orderId, relaisId, `Auto-${destLabel}`]);

    parcelId = newP.id;
    parcelRef = newP.reference;
    created = true;
    log.info(`[AUTO-PARCEL] New parcel ${parcelRef} → ${destLabel} (${openParcels.length + 1}/${MAX_OPEN_PARCELS_PER_DEST})`);
  } else {
    // SATURATED — queue the order
    log.info(`[AUTO-PARCEL] ⚠️ ${destLabel}: ${openParcels.length} colis ouverts (max ${MAX_OPEN_PARCELS_PER_DEST}) — ${order.reference} en file`);
    return {
      success: true,
      queued: true,
      order_ref: order.reference,
      destination: destLabel,
      reason: `${openParcels.length} colis ouverts vers ${destLabel} (max ${MAX_OPEN_PARCELS_PER_DEST}). Expédiez !`,
      open_parcels: openParcels.map(p => ({
        ref: p.reference,
        items: p.item_count,
        orders: p.order_count,
        full: p.item_count >= MAX_ITEMS_PER_PARCEL || p.order_count >= MAX_ORDERS_PER_PARCEL
      }))
    };
  }

  // Assign items — use ONLY columns that exist in parcel_items
  let assigned = 0;
  for (const item of items) {
    try {
      // parcel_items has: parcel_id, order_item_id, quantity, product_id
      await client.query(`
        INSERT INTO parcel_items (parcel_id, order_item_id, quantity, product_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT DO NOTHING
      `, [parcelId, item.id, item.quantity || 1, item.product_id || null]);
      assigned++;
    } catch (e) {
      // Minimal fallback — just core columns
      try {
        await client.query(`
          INSERT INTO parcel_items (parcel_id, order_item_id, quantity)
          VALUES ($1, $2, $3)
          ON CONFLICT DO NOTHING
        `, [parcelId, item.id, item.quantity || 1]);
        assigned++;
      } catch (e2) {
        log.warn(`[AUTO-PARCEL] Failed to assign item ${item.id}: ${e2.message}`);
      }
    }
  }

  log.info(`[AUTO-PARCEL] ${order.reference} → ${parcelRef} (${assigned}/${items.length} items, ${created ? 'new' : 'existing'})`);

  return {
    success: true,
    order_ref: order.reference,
    parcel_ref: parcelRef,
    parcel_id: parcelId,
    items_assigned: assigned,
    parcel_created: created,
    destination: destLabel
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
        JOIN parcels p ON p.id = pi.parcel_id AND p.status NOT IN ('cancelled')
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

  return {
    distributed: results.filter(r => r.success && !r.already_assigned && !r.queued).length,
    queued: results.filter(r => r.queued).length,
    already_assigned: results.filter(r => r.already_assigned).length,
    errors: results.filter(r => !r.success).length,
    details: results
  };
}


// ── Get distribution overview (for dashboard) ───────────────────
async function getDistribution() {
  // Open parcels with their orders
  const { rows: parcels } = await db.query(`
    SELECT
      p.id, p.reference, p.status, p.label,
      p.relais_id, r.name AS relais_name, r.island AS relais_island,
      p.created_at,
      COALESCE(agg.orders_count, 0)::int AS orders_count,
      COALESCE(agg.items_count, 0)::int AS items_count,
      COALESCE(agg.total_qty, 0)::int AS total_qty,
      COALESCE(agg.total_kmf, 0)::int AS total_kmf,
      COALESCE(agg.orders_json, '[]'::json) AS orders
    FROM parcels p
    LEFT JOIN relais r ON r.id = p.relais_id
    LEFT JOIN LATERAL (
      SELECT
        COUNT(DISTINCT oi.order_id) AS orders_count,
        COUNT(pi.id) AS items_count,
        SUM(COALESCE(pi.quantity, 1)) AS total_qty,
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
    ORDER BY r.island, p.created_at
  `);

  // Unassigned orders
  const { rows: unassigned } = await db.query(`
    SELECT o.id, o.reference, o.status, o.relais_id,
           o.total_kmf, o.created_at,
           u.full_name AS customer_name,
           r.name AS relais_name, r.island AS relais_island,
           (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)::int AS items_count
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN relais r ON r.id = o.relais_id
    WHERE o.status IN ('ordered', 'preparation')
      AND NOT EXISTS (
        SELECT 1 FROM parcel_items pi
        JOIN order_items oi ON oi.id = pi.order_item_id
        JOIN parcels p ON p.id = pi.parcel_id AND p.status NOT IN ('cancelled')
        WHERE oi.order_id = o.id
      )
    ORDER BY o.created_at ASC
  `);

  // Saturation
  const destCounts = {};
  for (const p of parcels) {
    const d = p.relais_island || 'UNKNOWN';
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
        (o.relais_island || '').toUpperCase() === dest.toUpperCase()
      ).length;
      if (queued > 0) {
        saturated.push({
          destination: dest,
          open_parcels: counts.open,
          full_parcels: counts.full,
          queued_orders: queued,
          message: `🚨 ${dest}: ${counts.open} colis ouverts (max ${MAX_OPEN_PARCELS_PER_DEST}), ${queued} commande(s) en file`
        });
      }
    }
  }

  return {
    parcels, unassigned, saturated,
    limits: { MAX_ITEMS_PER_PARCEL, MAX_ORDERS_PER_PARCEL, MAX_OPEN_PARCELS_PER_DEST }
  };
}


// ── Cleanup: delete ghost parcels (0 items, auto-created) ───────
async function cleanupGhostParcels() {
  const { rows: ghosts } = await db.query(`
    SELECT p.id, p.reference, p.status, p.created_at
    FROM parcels p
    WHERE p.status IN ('draft', 'preparation')
      AND p.label LIKE 'Auto-%'
      AND NOT EXISTS (
        SELECT 1 FROM parcel_items pi WHERE pi.parcel_id = p.id
      )
  `);

  let deleted = 0;
  for (const g of ghosts) {
    await db.query('DELETE FROM parcels WHERE id = $1', [g.id]);
    deleted++;
  }

  // Also delete parcels with no items and no order that look auto-generated
  const { rows: emptyAuto } = await db.query(`
    SELECT p.id, p.reference FROM parcels p
    WHERE p.status IN ('draft', 'preparation')
      AND p.reference LIKE 'KOM-P-%'
      AND NOT EXISTS (SELECT 1 FROM parcel_items pi WHERE pi.parcel_id = p.id)
      AND p.created_at > NOW() - INTERVAL '7 days'
  `);

  for (const g of emptyAuto) {
    await db.query('DELETE FROM parcels WHERE id = $1', [g.id]);
    deleted++;
  }

  log.info(`[AUTO-PARCEL] Cleanup: ${deleted} ghost parcels deleted`);
  return { deleted, ghosts: ghosts.concat(emptyAuto).map(g => g.reference) };
}


module.exports = {
  distributeOrder,
  distributeAll,
  getDistribution,
  cleanupGhostParcels,
  MAX_ITEMS_PER_PARCEL,
  MAX_ORDERS_PER_PARCEL,
  MAX_OPEN_PARCELS_PER_DEST,
};
