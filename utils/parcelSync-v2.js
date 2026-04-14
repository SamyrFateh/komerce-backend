/**
 * parcelSync-v2.js — Synchronisation Order ← Parcels
 * 
 * RÈGLE: Le statut d'une commande est TOUJOURS calculé
 * depuis l'état de ses colis. Jamais modifié manuellement.
 * 
 * Ce module remplace progressivement l'ancien parcelSync.js
 * et utilise le scan-engine pour les opérations.
 */

const pool = require('../db');

/**
 * Recalcule le statut d'une commande depuis ses colis.
 * Appelé automatiquement par le scan-engine après chaque scan.
 * Peut aussi être appelé manuellement (réconciliation).
 */
async function computeOrderStatus(orderId, client = null) {
  const db = client || pool;

  const { rows: parcels } = await db.query(
    `SELECT status FROM parcels WHERE order_id = $1 AND status != 'cancelled'`,
    [orderId]
  );

  if (parcels.length === 0) return null;

  const counts = {
    collected: 0, available: 0, in_transit: 0, 
    shipped: 0, preparation: 0, draft: 0
  };

  for (const p of parcels) {
    if (p.status === 'collected') counts.collected++;
    else if (['available', 'arrived'].includes(p.status)) counts.available++;
    else if (p.status === 'in_transit') counts.in_transit++;
    else if (p.status === 'shipped') counts.shipped++;
    else if (p.status === 'preparation') counts.preparation++;
    else if (p.status === 'draft') counts.draft++;
  }

  const total = parcels.length;

  if (counts.collected === total) return 'delivered';
  if (counts.collected > 0) return 'partially_delivered';
  if (counts.available > 0) return 'available';
  if (counts.in_transit > 0 || counts.shipped > 0) return 'in_transit';
  if (counts.preparation > 0) return 'processing';
  if (counts.draft === total) return 'pending';
  return 'processing';
}

/**
 * Synchronise les quantités order_items depuis les parcel_items
 */
async function syncOrderItemQuantities(orderId, client = null) {
  const db = client || pool;

  await db.query(`
    UPDATE order_items oi SET
      qty_allocated = COALESCE(agg.total_allocated, 0),
      qty_packed    = COALESCE(agg.total_packed, 0),
      qty_shipped   = COALESCE(agg.total_shipped, 0),
      qty_received  = COALESCE(agg.total_received, 0),
      qty_collected = COALESCE(agg.total_collected, 0)
    FROM (
      SELECT 
        pi.order_item_id,
        SUM(pi.qty_allocated) AS total_allocated,
        SUM(pi.qty_packed) AS total_packed,
        SUM(pi.qty_shipped) AS total_shipped,
        SUM(pi.qty_received) AS total_received,
        SUM(pi.qty_collected) AS total_collected
      FROM parcel_items pi
      JOIN parcels p ON p.id = pi.parcel_id AND p.order_id = $1 AND p.status != 'cancelled'
      WHERE pi.order_item_id IS NOT NULL
      GROUP BY pi.order_item_id
    ) agg
    WHERE oi.id = agg.order_item_id
  `, [orderId]);
}

/**
 * Full sync: quantités + statut commande
 */
async function fullSync(orderId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    await syncOrderItemQuantities(orderId, client);
    
    const newStatus = await computeOrderStatus(orderId, client);
    if (newStatus) {
      await client.query(
        `UPDATE orders SET status = $2, updated_at = NOW() WHERE id = $1`,
        [orderId, newStatus]
      );
    }

    await client.query('COMMIT');
    return { orderId, newStatus };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  computeOrderStatus,
  syncOrderItemQuantities,
  fullSync
};
