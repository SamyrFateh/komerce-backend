/**
 * KOMERCE — Double Écriture Parcels (utils/parcelSync.js)
 *
 * Phase 2 : Quand un scan est enregistré, met à jour les parcels en parallèle
 * du trigger legacy trg_scan_sync_status.
 *
 * PRINCIPES :
 *   1. NON BLOQUANT — erreur loggée, jamais de 500 pour le client
 *   2. IDEMPOTENT — appeler 2x avec le même step ne fait rien
 *   3. FORWARD ONLY — un parcel ne recule jamais dans le pipeline
 *   4. LEGACY SAFE — si pas de parcels trouvés, on ne fait rien
 *
 * UTILISÉ PAR :
 *   routes/scans.js — POST /api/scans, /collect, /verify-qr, triggerScan3()
 *
 * DÉPENDANCES :
 *   utils/parcels.js — computeOrderStatus(), STATUS_WEIGHT, PARCEL_STATUSES
 * ════════════════════════════════════════════════════════════════════════
 */

'use strict';

const { computeOrderStatus, STATUS_WEIGHT, PARCEL_STATUSES } = require('./parcels');
const db = require('../db');

// ═══════════════════════════════════════════════════════════════════════════════
// MAPPING : scan step → parcel status + timestamp column
// ═══════════════════════════════════════════════════════════════════════════════

const STEP_TO_PARCEL = Object.freeze({
  preparation:     { status: PARCEL_STATUSES.PREPARATION, tsCol: 'prepared_at' },
  hub_preparation: { status: PARCEL_STATUSES.PREPARATION, tsCol: 'prepared_at' },
  shipped:         { status: PARCEL_STATUSES.SHIPPED,     tsCol: 'shipped_at' },
  in_transit:      { status: PARCEL_STATUSES.IN_TRANSIT,   tsCol: 'in_transit_at' },
  relais_received: { status: PARCEL_STATUSES.AVAILABLE,    tsCol: 'available_at' },
  collected:       { status: PARCEL_STATUSES.COLLECTED,    tsCol: 'collected_at' },
});


// ═══════════════════════════════════════════════════════════════════════════════
// syncScanToParcels()
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Met à jour les parcels après un scan.
 *
 * @param {object} opts
 * @param {string} opts.order_id      — UUID de la commande
 * @param {string} opts.step           — Étape du scan (preparation, shipped, ...)
 * @param {string} opts.scan_id        — UUID du scan créé (pour lier parcel_id)
 * @param {string|null} opts.order_item_id — Si le scan vise un article précis
 * @returns {Promise<{synced: boolean, parcelsUpdated: number, computedStatus: string|null}>}
 */
async function syncScanToParcels({ order_id, step, scan_id, order_item_id = null }) {
  const mapping = STEP_TO_PARCEL[step];
  if (!mapping) {
    // Step inconnu (ex: hub_preparation sans mapping) — rien à faire
    return { synced: false, parcelsUpdated: 0, computedStatus: null };
  }

  const { status: newStatus, tsCol } = mapping;
  const newWeight = STATUS_WEIGHT[newStatus];

  // ── 1. Trouver les parcels à mettre à jour ────────────────────────────────
  let parcels;

  if (order_item_id) {
    // Scan article spécifique → trouver le parcel de cet article
    const { rows } = await db.query(
      `SELECT p.id, p.status
       FROM parcels p
       JOIN parcel_items pi ON pi.parcel_id = p.id
       WHERE pi.order_item_id = $1
         AND p.status != 'cancelled'
       LIMIT 1`,
      [order_item_id]
    );
    parcels = rows;
  } else {
    // Scan commande entière → tous les parcels actifs
    const { rows } = await db.query(
      `SELECT id, status
       FROM parcels
       WHERE order_id = $1 AND status != 'cancelled'`,
      [order_id]
    );
    parcels = rows;
  }

  // Pas de parcels ? Commande legacy — rien à faire
  if (!parcels.length) {
    return { synced: false, parcelsUpdated: 0, computedStatus: null };
  }

  // ── 2. Mettre à jour chaque parcel (forward only) ─────────────────────────
  let parcelsUpdated = 0;
  const firstParcelId = parcels[0].id; // pour lier le scan

  for (const parcel of parcels) {
    const currentWeight = STATUS_WEIGHT[parcel.status] ?? 0;

    // Forward only : ne pas reculer
    if (newWeight <= currentWeight) continue;

    await db.query(
      `UPDATE parcels
       SET status = $1::parcel_status,
           ${tsCol} = NOW(),
           updated_at = NOW()
       WHERE id = $2`,
      [newStatus, parcel.id]
    );
    parcelsUpdated++;
  }

  // ── 3. Lier le scan au parcel ─────────────────────────────────────────────
  if (scan_id && firstParcelId) {
    await db.query(
      `UPDATE scans SET parcel_id = $1 WHERE id = $2`,
      [firstParcelId, scan_id]
    );
  }

  // ── 4. Recompute orders.computed_status ────────────────────────────────────
  const { rows: allParcels } = await db.query(
    `SELECT status, type FROM parcels WHERE order_id = $1`,
    [order_id]
  );

  const computedStatus = computeOrderStatus(allParcels);

  await db.query(
    `UPDATE orders SET computed_status = $1, updated_at = NOW() WHERE id = $2`,
    [computedStatus, order_id]
  );

  console.log(
    `[PARCEL-SYNC] ✅ order=${order_id} step=${step} → ${parcelsUpdated} parcel(s) updated, computed_status=${computedStatus}`
  );

  return { synced: true, parcelsUpdated, computedStatus };
}


// ═══════════════════════════════════════════════════════════════════════════════
// safeSyncScanToParcels() — wrapper non bloquant
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Wrapper qui catch toutes les erreurs.
 * Utilisé dans les routes pour garantir qu'une erreur parcel
 * n'impacte JAMAIS la réponse au client.
 *
 * @param {object} opts - Mêmes paramètres que syncScanToParcels()
 * @returns {Promise<void>}
 */
async function safeSyncScanToParcels(opts) {
  try {
    await syncScanToParcels(opts);
  } catch (err) {
    console.error(`[PARCEL-SYNC] ❌ Erreur (order=${opts.order_id}, step=${opts.step}):`, err.message);
    // Non bloquant — le legacy a déjà fait le boulot
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  syncScanToParcels,
  safeSyncScanToParcels,
  STEP_TO_PARCEL,
};
