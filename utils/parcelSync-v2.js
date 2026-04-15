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

/**
 * Mapping statut calculé → statut ENUM valide.
 * Les statuts non-mappables retournent null (= on ne touche pas).
 */
const COMPUTED_TO_ENUM = {
  collected:           'collected',   // tous les colis récupérés
  available:           'available',   // au moins un colis disponible
  in_transit:          'in_transit',  // au moins un colis en transit/shipped
  preparation:         'preparation', // au moins un colis en préparation
  pending:             'pending',     // tous les colis en draft (pas encore traités)
  // Statuts sans équivalent direct dans order_status ENUM:
  // 'delivered' → 'collected' (tous récupérés = même sens)
  // 'partially_delivered' → null (ambigu, on ne touche pas — incident créé)
  // 'processing' → 'preparation' (en cours = même sens)
};

/**
 * Recalcule le statut d'une commande depuis ses colis.
 * Appelé automatiquement par le scan-engine après chaque scan.
 * Peut aussi être appelé manuellement (réconciliation).
 *
 * Retourne un statut ENUM valide ou null si non-déterminable.
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

  // Mapping vers statuts ENUM valides
  if (counts.collected === total) return 'collected';        // était 'delivered'
  if (counts.collected > 0) return null;                     // était 'partially_delivered' → ambig, skip
  if (counts.available > 0) return 'available';
  if (counts.in_transit > 0 || counts.shipped > 0) return 'in_transit';
  if (counts.preparation > 0) return 'preparation';         // était 'processing'
  if (counts.draft === total) return 'pending';
  return 'preparation';                                       // fallback safe (était 'processing')
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
