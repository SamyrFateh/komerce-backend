/**
 * ⚠️  MODULE ORPHELIN — NON IMPORTÉ EN PRODUCTION
 * Renommé depuis parcelSync-v2.js le 2026-05-23 (audit P2-1).
 * Ne pas require() ce fichier. La version active est utils/parcelSync.js.
 */

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
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  PATCH P0.3 (normalisation canonique):                             ║
 * ║  - Contrat aligné : computeOrderStatus() retourne toujours un      ║
 * ║    statut ENUM valide dès qu'au moins un colis existe.             ║
 * ║  - null est réservé au cas technique "aucun colis" (skip sync).    ║
 * ║  - Plus d'ambiguïté "ENUM valide ou null" côté métier.             ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

const pool = require('../db');
const { transitionOrderStatus } = require('../services/order-status-machine');
// ── CANONIQUE: source de vérité unique pour le calcul du statut agrégé ──
// Toute modification de la logique doit se faire dans utils/parcels.js.
const { computeOrderStatus: computeOrderStatusFromParcels } = require('./parcels');
const log = require('../utils/logger').child({ module: 'parcelSync-v2' });

/**
 * Recalcule le statut d'une commande depuis ses colis.
 * Délègue entièrement à la fonction canonique dans utils/parcels.js.
 *
 * ─── CONTRAT ────────────────────────────────────────────────────────────
 *  • Aucun colis pour cette commande
 *      → null  (cas technique — fullSync() retournera { skipped: true })
 *  • Au moins un colis (quel que soit le statut)
 *      → statut order_status ENUM valide, jamais null
 *        ex: 'preparation', 'shipped', 'in_transit', 'available',
 *            'collected', 'cancelled'
 * ────────────────────────────────────────────────────────────────────────
 *
 * @param {string}      orderId   UUID de la commande
 * @param {object|null} client    Client pg de transaction (optionnel)
 * @returns {Promise<string|null>}
 */
async function computeOrderStatus(orderId, client = null) {
  const db = client || pool;

  const { rows: parcels } = await db.query(
    `SELECT status, type FROM parcels WHERE order_id = $1`,
    [orderId]
  );

  // Aucun colis → null (skip technique, pas de sync nécessaire)
  // La commande conserve son statut actuel (ex: confirmed, pending).
  if (parcels.length === 0) return null;

  // Délègue à la fonction canonique.
  // Garantie : retourne toujours un statut ENUM valide si des colis existent.
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
 *
 * Si aucun colis n'existe pour la commande, le sync est skippé (newStatus = null).
 * Sinon, computeOrderStatus garantit un statut ENUM valide → transition tentée.
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
        log.warn(`[PARCEL-SYNC-V2] ⚠️ Transition refusée pour order=${orderId}: ${result.error}`);
      }

      await client.query('COMMIT');
      return { orderId, newStatus: result.noop ? result.previousStatus : newStatus, noop: result.noop };
    }

    // Aucun colis → skip technique (la commande garde son statut actuel)
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
