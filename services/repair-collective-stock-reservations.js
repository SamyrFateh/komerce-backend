/**
 * @komerce-arch
 * @role          shared-cart-repair-collective-stock-reservations
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/collective-stock-reservation-service.js
 * @used-by       routes/admin-collective-repairs.js
 * @db-read       collective_payment_sessions, collective_stock_reservations, collective_workspaces
 * @db-write      alerts
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  shared-cart
 * @version       2026-06
 */

'use strict';

/**
 * I-SWEEP-4B — Repair des réservations stock collectives.
 *
 * Cas couverts :
 * - workspace collectif avec order_id créée mais réservations encore reserved
 *   => consommer les réservations ;
 * - workspace/session terminé sans order avec réservations encore reserved
 *   => libérer ou expirer les réservations.
 */

const db = require('../db');
const { createAlert } = require('../utils/alerts');
const stockReservations = require('./collective-stock-reservation-service');

async function repairCollectiveStockReservations({ dryRun = true, limit = 50, user }) {
  if (!user?.id || user.role !== 'admin') {
    return { status: 403, body: { error: 'Accès réservé admin' } };
  }

  const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 200));
  await stockReservations.ensureTable();

  const { rows: consumeCandidates } = await db.query(`
    SELECT cw.id AS workspace_id, cw.order_id, cw.status,
           COUNT(csr.id)::int AS reservations_count
    FROM collective_workspaces cw
    JOIN collective_stock_reservations csr ON csr.workspace_id = cw.id
    WHERE cw.order_id IS NOT NULL
      AND csr.status = 'reserved'
    GROUP BY cw.id, cw.order_id, cw.status
    ORDER BY cw.updated_at DESC NULLS LAST, cw.created_at DESC
    LIMIT $1
  `, [safeLimit]);

  const remainingLimit = Math.max(1, safeLimit - consumeCandidates.length);

  const { rows: releaseCandidates } = await db.query(`
    SELECT cw.id AS workspace_id, cw.order_id, cw.status,
           COUNT(csr.id)::int AS reservations_count
    FROM collective_workspaces cw
    JOIN collective_stock_reservations csr ON csr.workspace_id = cw.id
    LEFT JOIN collective_payment_sessions cps ON cps.workspace_id = cw.id
    WHERE cw.order_id IS NULL
      AND csr.status = 'reserved'
      AND (
        cw.status IN ('session_ended', 'archived')
        OR cps.status IN ('ended', 'failed')
        OR csr.reserved_until <= NOW()
      )
    GROUP BY cw.id, cw.order_id, cw.status, cw.updated_at, cw.created_at
    ORDER BY cw.updated_at DESC NULLS LAST, cw.created_at DESC
    LIMIT $1
  `, [remainingLimit]);

  if (dryRun) {
    return {
      status: 200,
      body: {
        dry_run: true,
        consume_count: consumeCandidates.length,
        release_count: releaseCandidates.length,
        consume_candidates: consumeCandidates,
        release_candidates: releaseCandidates,
      },
    };
  }

  const consumed = [];
  const released = [];
  const failed = [];

  for (const c of consumeCandidates) {
    try {
      await stockReservations.consumeForWorkspace(c.workspace_id);
      consumed.push(c);
    } catch (err) {
      failed.push({ action: 'consume', ...c, error: err.message });
      await insertRepairAlert(c, err, 'consume');
    }
  }

  for (const c of releaseCandidates) {
    try {
      await stockReservations.releaseForWorkspace(c.workspace_id, 'I-SWEEP-4B repair');
      released.push(c);
    } catch (err) {
      failed.push({ action: 'release', ...c, error: err.message });
      await insertRepairAlert(c, err, 'release');
    }
  }

  return {
    status: failed.length ? 207 : 200,
    body: {
      dry_run: false,
      consumed_count: consumed.length,
      released_count: released.length,
      failed_count: failed.length,
      consumed,
      released,
      failed,
    },
  };
}

async function insertRepairAlert(candidate, err, action) {
  try {
    await createAlert(db, {
      type: 'collective_stock_reservation_repair_failed',
      entityType: 'collective_workspace',
      entityId: candidate.workspace_id,
      severity: 'medium',
      title: `Collective stock reservation ${action} failed for workspace ${candidate.workspace_id}`,
      description: `order_id=${candidate.order_id || 'n/a'} action=${action} error=${err.message}`,
    });
  } catch (_e) { /* non-bloquant */ }
}

module.exports = { repairCollectiveStockReservations };
