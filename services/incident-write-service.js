/**
 * @komerce-arch
 * @role          incident-management-write-boundary
 * @domain        incident-management
 * @layer         service
 * @criticality   high
 * @inputs        caller_owned_queryable, incident_mutation_payload
 * @outputs       incident_mutation_result
 * @depends       none
 * @used-by       services/scan-engine.js, services/reconciliation-service.js, services/alert-engine.js,
 *                routes/admin/users.js, routes/admin/system.js, routes/ops-api.js
 * @db-read       incidents
 * @db-write      incidents
 * @db-txn        caller_owned_queryable
 * @doctrine      lifecycle_owner_boundary, preserve_caller_transaction
 * @impact-areas  incident-management, logistics, payments, notifications, dashboard, platform-ops
 * @version       2026-08
 */

'use strict';

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('[incident-write-service] requires an executor with query()');
  }
  return executor;
}

async function createScanIncident(executor, params) {
  const db = requireExecutor(executor);
  const { rows: [incident] } = await db.query(`
    INSERT INTO incidents (
      parcel_id, order_id, order_item_id, scan_event_id,
      incident_type, severity, title, description, details,
      client_impact, detected_by, detected_source
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    RETURNING *
  `, [
    params.parcel_id || null, params.order_id || null,
    params.order_item_id || null, params.scan_event_id || null,
    params.incident_type, params.severity || 'medium',
    params.title, params.description || null,
    JSON.stringify(params.details || {}),
    params.client_impact || 'none',
    params.detected_by || null, params.detected_source || 'system'
  ]);
  return incident;
}

async function createReconciliationIncident(executor, orderId, parcelId, orderItemId, issue) {
  const db = requireExecutor(executor);

  const { rows: existing } = await db.query(`
    SELECT id FROM incidents
    WHERE order_id = $1
      AND COALESCE(parcel_id::text, '') = COALESCE($2::text, '')
      AND incident_type = 'reconciliation_error'
      AND status IN ('open', 'investigating')
      AND details->>'type' = $3
    LIMIT 1
  `, [orderId, parcelId, issue.type]);

  if (existing.length > 0) return existing[0];

  const { rows: [incident] } = await db.query(`
    INSERT INTO incidents (
      parcel_id, order_id, order_item_id,
      incident_type, severity, title, description, details,
      detected_source
    ) VALUES ($1,$2,$3,'reconciliation_error',$4,$5,$6,$7,'reconciliation')
    RETURNING *
  `, [
    parcelId, orderId, orderItemId,
    issue.severity, issue.message, issue.message,
    JSON.stringify({ ...issue.details, type: issue.type })
  ]);

  return incident;
}

async function createAlertEngineIncidentIfNew(executor, {
  type,
  parcelId,
  orderId,
  severity,
  description,
  metadata,
}) {
  const db = requireExecutor(executor);

  const { rows: existing } = await db.query(`
    SELECT id FROM incidents
    WHERE parcel_id = $1 AND type = $2 AND status IN ('open', 'investigating')
    LIMIT 1
  `, [parcelId, type]);

  if (existing.length > 0) return null;

  const { rows: [incident] } = await db.query(`
    INSERT INTO incidents (parcel_id, order_id, type, severity, description, metadata, detected_by)
    VALUES ($1, $2, $3, $4, $5, $6, 'alert_engine')
    RETURNING *
  `, [parcelId, orderId, type, severity, description, JSON.stringify(metadata || {})]);

  return incident;
}

async function acknowledgeAlertEngineIncident(executor, alertId, acknowledgedBy) {
  const db = requireExecutor(executor);
  const { rows: [updated] } = await db.query(`
    UPDATE incidents
    SET status = 'investigating',
        resolved_by = $2,
        updated_at = NOW()
    WHERE id = $1 AND status = 'open'
    RETURNING *
  `, [alertId, acknowledgedBy || 'admin']);
  return updated;
}

async function resolveOpsIncident(executor, { incidentId, resolution }) {
  const db = requireExecutor(executor);
  return db.query(
    `UPDATE incidents SET status = 'resolved', resolved_at = NOW(),
     resolution = $1 WHERE id = $2`,
    [resolution, incidentId]
  );
}

async function detachUserFromIncidents(executor, userId) {
  const db = requireExecutor(executor);
  await db.query(
    'UPDATE incidents SET detected_by = NULL WHERE detected_by = $1::uuid',
    [userId]
  );
  await db.query(
    'UPDATE incidents SET resolved_by = NULL WHERE resolved_by = $1::uuid',
    [userId]
  );
}

async function seedIncident(executor, values) {
  const db = requireExecutor(executor);
  if (!Array.isArray(values) || values.length !== 16) {
    throw new TypeError('[seedIncident] expected exactly 16 positional values');
  }
  return db.query(
    `INSERT INTO incidents (
       id, parcel_id, order_id, incident_type, severity,
       status, title, description, details,
       client_impact, client_notified, detected_by,
       detected_source, resolution, resolved_at, resolved_by
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4, $5,
       $6, $7, $8, $9::jsonb,
       $10, $11, $12::uuid,
       $13, $14::jsonb, $15, $16
     )`,
    values
  );
}

module.exports = {
  createScanIncident,
  createReconciliationIncident,
  createAlertEngineIncidentIfNew,
  acknowledgeAlertEngineIncident,
  resolveOpsIncident,
  detachUserFromIncidents,
  seedIncident,
};
