/**
 * KOMERCE — Parcel Sync Engine (utils/parcelSync.js) — v2.0 PHASE 3
 *
 * Phase 3 : SOURCE DE VÉRITÉ UNIQUE pour orders.status.
 * Le trigger legacy trg_scan_sync_status est désactivé.
 * Ce module est maintenant le SEUL chemin qui met à jour orders.status
 * après un scan.
 *
 * CHANGEMENTS Phase 2 → Phase 3 :
 *   [P3-1] orders.computed_status → orders.status (source de vérité)
 *   [P3-2] Mise à jour timestamps sur orders (shipped_at, in_transit_at, etc.)
 *   [P3-3] Insert dans order_status_history (reprise du rôle du trigger)
 *   [P3-4] safeSyncScanToParcels() est maintenant awaité dans scans.js
 *
 * PRINCIPES (inchangés) :
 *   1. SAFE — erreur loggée via safeSyncScanToParcels, jamais de 500
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
// MAPPING : scan step → parcel status + timestamp column (parcels + orders)
// ═══════════════════════════════════════════════════════════════════════════════

const STEP_TO_PARCEL = Object.freeze({
  preparation:     { status: PARCEL_STATUSES.PREPARATION, tsCol: 'prepared_at',   orderTsCol: null },
  hub_preparation: { status: PARCEL_STATUSES.PREPARATION, tsCol: 'prepared_at',   orderTsCol: null },
  shipped:         { status: PARCEL_STATUSES.SHIPPED,     tsCol: 'shipped_at',    orderTsCol: 'shipped_at' },
  in_transit:      { status: PARCEL_STATUSES.IN_TRANSIT,  tsCol: 'in_transit_at', orderTsCol: 'in_transit_at' },
  relais_received: { status: PARCEL_STATUSES.AVAILABLE,   tsCol: 'available_at',  orderTsCol: 'available_at' },
  collected:       { status: PARCEL_STATUSES.COLLECTED,   tsCol: 'collected_at',  orderTsCol: 'collected_at' },
});

// [P3-2] Mapping scan step → order status (même logique que l'ancien trigger)
// Utilisé pour order_status_history et les timestamps orders
const STEP_TO_ORDER_STATUS = Object.freeze({
  preparation:     'preparation',
  hub_preparation: 'preparation',
  shipped:         'shipped',
  in_transit:      'in_transit',
  relais_received: 'available',
  collected:       'collected',
});


// ═══════════════════════════════════════════════════════════════════════════════
// syncScanToParcels() — v2.0 Phase 3
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Met à jour les parcels ET orders.status après un scan.
 *
 * Phase 3 : Ce module est la SOURCE DE VÉRITÉ.
 * Le trigger legacy est désactivé.
 *
 * @param {object} opts
 * @param {string} opts.order_id       — UUID de la commande
 * @param {string} opts.step           — Étape du scan (preparation, shipped, ...)
 * @param {string} opts.scan_id        — UUID du scan créé (pour lier parcel_id + history)
 * @param {string|null} opts.order_item_id — Si le scan vise un article précis
 * @param {string|null} opts.scanned_by    — [P3-3] UUID de l'utilisateur qui a scanné
 * @param {string|null} opts.notes         — [P3-3] Notes du scan (pour l'historique)
 * @param {boolean}     opts.skipHistory   — [P3-3] Si true, ne pas insérer dans order_status_history
 *                                            (utilisé par verify-qr qui gère l'historique dans sa transaction)
 * @returns {Promise<{synced: boolean, parcelsUpdated: number, orderStatus: string|null}>}
 */
async function syncScanToParcels({ order_id, step, scan_id, order_item_id = null, scanned_by = null, notes = null, skipHistory = false }) {
  const mapping = STEP_TO_PARCEL[step];
  if (!mapping) {
    // Step inconnu — rien à faire
    return { synced: false, parcelsUpdated: 0, orderStatus: null };
  }

  const { status: newStatus, tsCol, orderTsCol } = mapping;
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
    return { synced: false, parcelsUpdated: 0, orderStatus: null };
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

  // ── 4. [P3-1] Recompute orders.status (SOURCE DE VÉRITÉ) ─────────────────
  // Exclure les parcels cancelled pour un calcul correct
  const { rows: activeParcels } = await db.query(
    `SELECT status, type FROM parcels
     WHERE order_id = $1 AND status != 'cancelled'`,
    [order_id]
  );

  // Inclure aussi les cancelled pour computeOrderStatus (il les gère en interne)
  const { rows: allParcels } = await db.query(
    `SELECT status, type FROM parcels WHERE order_id = $1`,
    [order_id]
  );

  const orderStatus = computeOrderStatus(allParcels);

  // [P3-1] Écrire dans orders.status + [P3-2] timestamp sur orders
  const tsParts = [];
  const tsValues = [orderStatus, order_id];

  if (orderTsCol) {
    // Ne mettre à jour le timestamp que s'il n'est pas déjà set (forward only)
    tsParts.push(`${orderTsCol} = COALESCE(${orderTsCol}, NOW())`);
  }

  const tsClause = tsParts.length > 0 ? `, ${tsParts.join(', ')}` : '';

  await db.query(
    `UPDATE orders
     SET status = $1::order_status${tsClause}, updated_at = NOW()
     WHERE id = $2`,
    tsValues
  );

  // ── 5. [P3-3] Insert dans order_status_history ────────────────────────────
  // Reprend le rôle de l'ancien trigger sync_order_status_from_scan.
  // skipHistory = true si le caller gère déjà l'historique (ex: verify-qr transaction)
  const stepOrderStatus = STEP_TO_ORDER_STATUS[step];
  if (stepOrderStatus && scan_id && !skipHistory) {
    try {
      await db.query(
        `INSERT INTO order_status_history (order_id, status, scan_id, changed_by, note)
         VALUES ($1, $2::order_status, $3, $4, $5)`,
        [order_id, stepOrderStatus, scan_id, scanned_by, notes]
      );
    } catch (histErr) {
      // L'historique ne doit pas bloquer le flux principal
      console.warn(`[PARCEL-SYNC] ⚠️ History insert failed (order=${order_id}):`, histErr.message);
    }
  }

  console.log(
    `[PARCEL-SYNC] ✅ order=${order_id} step=${step} → ${parcelsUpdated} parcel(s) updated, status=${orderStatus}`
  );

  return { synced: true, parcelsUpdated, orderStatus };
}


// ═══════════════════════════════════════════════════════════════════════════════
// safeSyncScanToParcels() — wrapper safe
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Wrapper qui catch toutes les erreurs.
 * Utilisé dans les routes pour garantir qu'une erreur parcel
 * n'impacte JAMAIS la réponse au client.
 *
 * [P3-4] En Phase 3, ce wrapper est awaité dans scans.js (plus fire-and-forget).
 * Le catch garantit toujours qu'aucune erreur ne remonte au client.
 *
 * @param {object} opts - Mêmes paramètres que syncScanToParcels()
 * @returns {Promise<{synced: boolean, parcelsUpdated: number, orderStatus: string|null}>}
 */
async function safeSyncScanToParcels(opts) {
  try {
    return await syncScanToParcels(opts);
  } catch (err) {
    console.error(`[PARCEL-SYNC] ❌ Erreur (order=${opts.order_id}, step=${opts.step}):`, err.message);
    // [P3-4] Le trigger legacy est désactivé — on log mais on ne crashe pas.
    // TODO Phase 4 : alerting/monitoring pour ces erreurs
    return { synced: false, parcelsUpdated: 0, orderStatus: null };
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  syncScanToParcels,
  safeSyncScanToParcels,
  STEP_TO_PARCEL,
  STEP_TO_ORDER_STATUS,
};
