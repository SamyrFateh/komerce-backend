/**
 * parcelSync-v2.js — Synchronisation Order ← Parcels
 * 
 * RÈGLE: Le statut d'une commande est TOUJOURS calculé
 * depuis l'état de ses colis. Jamais modifié manuellement.
 * 
 * Ce module remplace progressivement l'ancien parcelSync.js
 * et utilise le scan-engine pour les opérations.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  PATCH P0.2a (15/04/2026):                                         ║
 * ║  - computeOrderStatus() retourne désormais des statuts ENUM valides ║
 * ║  - fullSync() passe par transitionOrderStatus() (SSOT)              ║
 * ║  - Plus de UPDATE orders SET status = direct                        ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

const pool = require('../db');
const { transitionOrderStatus } = require('../services/order-status-machine');
// ── S2 FIX: Utilise la version CANONIQUE de computeOrderStatus ──
// Une seule source de vérité pour le calcul du statut agrégé.
const { computeOrderStatus: computeOrderStatusFromParcels } = require('./parcels');

/**
 * Recalcule le statut d'une commande depuis ses colis.
 * Délègue à la version canonique dans utils/parcels.js.
 *
 * Retourne un statut ENUM valide ou null si non-déterminable.
 */
async function computeOrderStatus(orderId, client = null) {
  const db = client || pool;

  const { rows: parcels } = await db.query(
    `SELECT status, type FROM parcels WHERE order_id = $1`,
    [orderId]
  );

  // Pas de colis du tout → null (skip, pas de sync nécessaire)
  if (parcels.length === 0) return null;

  // Délègue à la version canonique (gère cancelled, partial collected, etc.)
  return computeOrderStatusFromParcels(parcels);
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
 * Full sync: quantités + statut commande via STATE MACHINE (SSOT)
 *
 * PATCH P0.2a: Remplace le UPDATE direct par transitionOrderStatus().
 * La state machine gère: validation, historique, timestamps, side-effects.
 */
async function fullSync(orderId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    await syncOrderItemQuantities(orderId, client);
    
    const newStatus = await computeOrderStatus(orderId, client);
    
    if (newStatus) {
      // ── PATCH P0.2a: Passe par la state machine au lieu de UPDATE direct ──
      const result = await transitionOrderStatus({
        orderId,
        newStatus,
        actor: { id: null, role: 'system' },
        source: 'system',
        note: `[parcelSync-v2] Sync depuis colis → ${newStatus}`,
        dbClient: client,
      });

      if (!result.success && !result.noop) {
        // La transition a été refusée — log warning mais ne crash pas
        console.warn(`[PARCEL-SYNC-V2] ⚠️ Transition refusée pour order=${orderId}: ${result.error}`);
      }

      await client.query('COMMIT');
      return { orderId, newStatus: result.noop ? result.previousStatus : newStatus, noop: result.noop };
    }

    await client.query('COMMIT');
    return { orderId, newStatus: null, skipped: true };
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
