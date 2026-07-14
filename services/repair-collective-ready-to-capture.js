/**
 * @komerce-arch
 * @role          shared-cart-repair-collective-ready-to-capture
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/collective-payment-orchestrator.js
 * @used-by       routes/admin-collective-repairs.js
 * @db-read       collective_payment_sessions, collective_workspaces
 * @db-write      alerts
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  shared-cart
 * @version       2026-06
 */

'use strict';

/**
 * I-SWEEP-4A — Repair des sessions collectives ready_to_capture.
 *
 * Cas couvert : process crash après passage session.status = ready_to_capture
 * et avant exécution de captureAllAndCreateOrder(session.id).
 */

const db = require('../db');
const { createAlert } = require('../utils/alerts');

async function repairCollectiveReadyToCapture({ dryRun = true, limit = 25, minAgeMinutes = 5, user }) {
  if (!user?.id || user.role !== 'admin') {
    return { status: 403, body: { error: 'Accès réservé admin' } };
  }

  const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 25, 100));
  const safeMinAge = Math.max(0, Math.min(parseInt(minAgeMinutes, 10) || 5, 1440));

  const { rows: candidates } = await db.query(`
    SELECT cps.id, cps.workspace_id, cps.total_to_pay_kmf, cps.amount_secured_kmf,
           cps.created_at, cw.public_token_hash, cw.event_name, cw.order_id
    FROM collective_payment_sessions cps
    JOIN collective_workspaces cw ON cw.id = cps.workspace_id
    WHERE cps.status = 'ready_to_capture'
      AND cps.created_at <= NOW() - ($2 || ' minutes')::interval
      AND cw.order_id IS NULL
    ORDER BY cps.created_at ASC
    LIMIT $1
  `, [safeLimit, String(safeMinAge)]);

  if (dryRun) {
    return {
      status: 200,
      body: {
        dry_run: true,
        min_age_minutes: safeMinAge,
        count: candidates.length,
        candidates,
      },
    };
  }

  const orchestrator = require('./collective-payment-orchestrator');
  const repaired = [];
  const failed = [];

  for (const session of candidates) {
    try {
      const result = await orchestrator.captureAllAndCreateOrder(session.id);
      repaired.push({
        session_id: session.id,
        workspace_id: session.workspace_id,
        result,
      });
    } catch (err) {
      failed.push({
        session_id: session.id,
        workspace_id: session.workspace_id,
        error: err.message,
      });

      try {
        await createAlert(db, {
          type: 'collective_repair_ready_to_capture_failed',
          entityType: 'collective_session',
          entityId: session.id,
          severity: 'medium',
          title: `Repair collective ready_to_capture failed for session ${session.id}`,
          description: `workspace_id=${session.workspace_id} error=${err.message}`,
        });
      } catch (_e) { /* non-bloquant */ }
    }
  }

  return {
    status: failed.length ? 207 : 200,
    body: {
      dry_run: false,
      min_age_minutes: safeMinAge,
      scanned: candidates.length,
      repaired_count: repaired.length,
      failed_count: failed.length,
      repaired,
      failed,
    },
  };
}

module.exports = { repairCollectiveReadyToCapture };
