/**
 * @komerce-arch
 * @role          logistics-parcel-sync
 * @domain        logistics
 * @layer         util
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/order-status-machine.js, utils/logger.js, utils/parcels.js
 * @db-write      alerts, parcel_events, parcels, scans
 * @db-write-via:order-status-machine product_variants, order_status_history, products
 * @db-read      parcel_items, parcels
 * @used-by       routes/hub-dashboard.js, routes/logistics.js, routes/parcels.js, routes/transit-dashboard.js, routes/transitaire-api.js, services/hub-operations.js, services/parcelOptimizationService.js, services/scan-operations.js, services/verify-qr-collection.js
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-06
 */

/**
 * KOMERCE — Parcel Sync Engine (utils/parcelSync.js) — v3.0 MACHINE
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
 * v2.1 — FIX-004 (7 avril 2026) :
 *   Ajout paramètre optionnel `dbClient` à syncScanToParcels et
 *   safeSyncScanToParcels. Quand fourni, toutes les queries passent par
 *   le client de transaction au lieu du pool → le verrou FOR UPDATE
 *   est maintenu pendant tout le sync dans hub.js.
 *
 * PRINCIPES (inchangés) :
 *   1. SAFE — erreur loggée via safeSyncScanToParcels, jamais de 500
 *   2. IDEMPOTENT — appeler 2x avec le même step ne fait rien
 *   3. FORWARD ONLY — un parcel ne recule jamais dans le pipeline
 *   4. LEGACY SAFE — si pas de parcels trouvés, on ne fait rien
 *
 * UTILISÉ PAR :
 *   routes/scans.js — POST /api/scans, /collect, /verify-qr, triggerScan3()
 *   routes/hub.js   — POST /api/hub/scan, /seal (avec dbClient = transaction)
 *
 * DÉPENDANCES :
 *   utils/parcels.js — computeOrderStatus(), STATUS_WEIGHT, PARCEL_STATUSES
 * ════════════════════════════════════════════════════════════════════════
 */

'use strict';

const { computeOrderStatus, STATUS_WEIGHT, PARCEL_STATUSES } = require('./parcels');
const { transitionOrderStatus } = require('../services/order-status-machine');
const db = require('../db');
const log = require('../utils/logger').child({ module: 'parcelSync' });

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
// syncScanToParcels() — v2.1 Phase 3
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
 * @param {boolean}     opts.skipHistory   — DEPRECATED: machine handles history (kept for backward compat)
 * @param {object|null} dbClient           — [FIX-004] Client pg de transaction (optionnel).
 *                                            Si fourni, toutes les queries passent par ce client
 *                                            au lieu du pool. Permet de maintenir le verrou
 *                                            FOR UPDATE de hub.js pendant tout le sync.
 * @returns {Promise<{synced: boolean, parcelsUpdated: number, orderStatus: string|null}>}
 */
async function syncScanToParcels({ order_id, step, scan_id, order_item_id = null, scanned_by = null, notes = null, skipHistory = false }, dbClient = null) {
  // FIX-004: utiliser le client de transaction si fourni, sinon le pool
  const q = dbClient || db;

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
    const { rows } = await q.query(
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
    const { rows } = await q.query(
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

    await q.query(
      `UPDATE parcels
       SET status = $1::parcel_status,
           ${tsCol} = NOW(),
           updated_at = NOW()
       WHERE id = $2`,
      [newStatus, parcel.id]
    );
    parcelsUpdated++;

    // ── TRACE : un événement par transition (journal unique) ──────────────
    // parcel_events devient la source d'historique du colis (cf. réconciliation).
    await q.query(
      `INSERT INTO parcel_events (parcel_id, event_type, actor_id, weight_kg, notes, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [parcel.id, newStatus, scanned_by, newWeight, notes || null,
       JSON.stringify({ step, from: parcel.status, scan_id })]
    );
  }

  // ── 3. Lier le scan au parcel ─────────────────────────────────────────────
  if (scan_id && firstParcelId) {
    await q.query(
      `UPDATE scans SET parcel_id = $1 WHERE id = $2`,
      [firstParcelId, scan_id]
    );
  }

  // ── 4. Recompute order status + transition via MACHINE (D1/D2) ──────────
  // The machine is the SINGLE SOURCE OF TRUTH for orders.status.
  // It handles: status validation, timestamps, order_status_history.
  const { rows: allParcels } = await q.query(
    `SELECT status, type FROM parcels WHERE order_id = $1`,
    [order_id]
  );

  const orderStatus = computeOrderStatus(allParcels);

  // Call the machine — source 'scan' allows forward-only transitions
  const transition = await transitionOrderStatus({
    orderId: order_id,
    newStatus: orderStatus,
    actor: { id: scanned_by, role: 'system' },
    source: 'scan',
    scanId: scan_id,
    note: notes || `[scan] step=${step}`,
    dbClient: q,
  });

  // Use the machine's result (may differ if it was a no-op)
  const finalOrderStatus = transition.newStatus || orderStatus;

  // ── 5. History — HANDLED BY MACHINE (D6) ──────────────────────────────
  // No direct insert into order_status_history here.
  // The machine guarantees every transition is logged.

  log.info(
    `[PARCEL-SYNC] ✅ order=${order_id} step=${step} → ${parcelsUpdated} parcel(s) updated, status=${finalOrderStatus}`
  );

  return { synced: true, parcelsUpdated, orderStatus: finalOrderStatus };
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
 * [FIX-004] Accepte un dbClient optionnel pour le mode transactionnel.
 *
 * @param {object} opts - Mêmes paramètres que syncScanToParcels()
 * @param {object|null} dbClient - Client pg de transaction (optionnel)
 * @returns {Promise<{synced: boolean, parcelsUpdated: number, orderStatus: string|null}>}
 */
async function safeSyncScanToParcels(opts, dbClient = null) {
  try {
    return await syncScanToParcels(opts, dbClient);
  } catch (err) {
    log.error(`[PARCEL-SYNC] ❌ Erreur (order=${opts.order_id}, step=${opts.step}):`, err.message);
    // PATCH P2-10 / TODO #387 : alerte 'elevated' si la sync parcel échoue.
    // Sans cet alerting, la divergence scan/parcel/order est invisible en production.
    // L'alerte est non-bloquante (fire-and-forget) — on ne laisse jamais crasher le client.
    const { createAlert } = require('./alerts');
    createAlert(db, {
      type: 'parcel_sync_failed',
      entityType: 'order',
      entityId: opts.order_id || null,
      severity: 'medium',
      title: `safeSyncScanToParcels failed — order ${opts.order_id} step ${opts.step}`,
      description: `scan_id=${opts.scan_id} error=${err.message}`,
    }).catch(alertErr => log.error('[PARCEL-SYNC] Impossible d\'insérer l\'alerte:', alertErr.message));

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
