/**
 * @komerce-arch
 * @role          incident-management-write-boundary
 * @domain        incident-management
 * @layer         service
 * @criticality   high
 * @inputs        caller_owned_queryable, incident_mutation_payload
 * @outputs       incident_mutation_result
 * @depends       services/incident-governance
 * @used-by       services/scan-engine.js, services/reconciliation-service.js, services/alert-engine.js,
 *                routes/admin/users.js, routes/admin/system.js, routes/ops-api.js
 * @db-read       incidents
 * @db-write      incidents
 * @db-txn        caller_owned_queryable
 * @doctrine      lifecycle_owner_boundary, preserve_caller_transaction, F2_INCIDENT_GOVERNANCE_CONTRACT
 * @impact-areas  incident-management, logistics, payments, notifications, dashboard, platform-ops
 * @version       2026-09
 */
'use strict';

const { resolveGovernanceOrThrow, assertTerminalResolutionAllowed } = require('./incident-governance');

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('[incident-write-service] requires an executor with query()');
  }
  return executor;
}

async function createScanIncident(executor, params) {
  const db = requireExecutor(executor);
  const governance = resolveGovernanceOrThrow({ incident_type: params.incident_type });
  const { rows: [incident] } = await db.query(`
    INSERT INTO incidents (
      parcel_id, order_id, order_item_id, scan_event_id,
      incident_type, severity, title, description, details,
      client_impact, detected_by, detected_source,
      origin_domain, resolver_domain, resolution_class
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    RETURNING *
  `, [
    params.parcel_id || null, params.order_id || null,
    params.order_item_id || null, params.scan_event_id || null,
    params.incident_type, params.severity || 'medium', params.title,
    params.description || null, JSON.stringify(params.details || {}),
    params.client_impact || 'none', params.detected_by || null,
    params.detected_source || 'system', governance.origin_domain,
    governance.resolver_domain, governance.resolution_class,
  ]);
  return incident;
}

async function createReconciliationIncident(executor, orderId, parcelId, orderItemId, issue) {
  const db = requireExecutor(executor);
  const governance = resolveGovernanceOrThrow({ incident_type: 'reconciliation_error', subtype: issue.type });
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
      incident_type, severity, title, description, details, detected_source,
      origin_domain, resolver_domain, resolution_class
    ) VALUES ($1,$2,$3,'reconciliation_error',$4,$5,$6,$7,'reconciliation',$8,$9,$10)
    RETURNING *
  `, [
    parcelId, orderId, orderItemId, issue.severity, issue.message, issue.message,
    JSON.stringify({ ...issue.details, type: issue.type }), governance.origin_domain,
    governance.resolver_domain, governance.resolution_class,
  ]);
  return incident;
}

const ALERT_TYPE_TO_INCIDENT_TYPE = Object.freeze({ stuck_parcel: 'delay' });

async function createAlertEngineIncidentIfNew(executor, {
  type, parcelId, orderId, severity, description, metadata,
}) {
  const db = requireExecutor(executor);
  const incidentType = ALERT_TYPE_TO_INCIDENT_TYPE[type] || type;
  const governance = resolveGovernanceOrThrow({ incident_type: incidentType });

  const { rows: existing } = await db.query(`
    SELECT id FROM incidents
    WHERE parcel_id = $1
      AND incident_type = $2
      AND status IN ('open', 'investigating')
      AND details->>'alert_type' = $3
    LIMIT 1
  `, [parcelId, incidentType, type]);
  if (existing.length > 0) return null;

  const details = { ...(metadata || {}), alert_type: type };
  const { rows: [incident] } = await db.query(`
    INSERT INTO incidents (
      parcel_id, order_id, incident_type, severity,
      title, description, details, detected_source,
      origin_domain, resolver_domain, resolution_class
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,'system',$8,$9,$10)
    RETURNING *
  `, [
    parcelId, orderId, incidentType, severity || 'medium',
    description || type, description || null, JSON.stringify(details),
    governance.origin_domain, governance.resolver_domain, governance.resolution_class,
  ]);
  return incident;
}

async function acknowledgeAlertEngineIncident(executor, alertId, acknowledgedBy) {
  const db = requireExecutor(executor);
  const { rows: [updated] } = await db.query(`
    UPDATE incidents
    SET status = 'investigating', resolved_by = $2, updated_at = NOW()
    WHERE id = $1 AND status = 'open'
    RETURNING *
  `, [alertId, acknowledgedBy || 'admin']);
  return updated;
}

async function resolveOpsIncident(executor, { incidentId, resolution }) {
  const db = requireExecutor(executor);
  const { rows } = await db.query(
    `SELECT incident_type, details, resolution_class, resolver_domain FROM incidents WHERE id = $1`,
    [incidentId]
  );
  const incident = rows && rows[0];
  if (incident) {
    assertTerminalResolutionAllowed({
      incident_type: incident.incident_type,
      subtype: incident.details && incident.details.type,
      resolution_class: incident.resolution_class,
      resolver_domain: incident.resolver_domain,
    }, 'auto_resolved');
  }
  return db.query(
    `UPDATE incidents SET status = 'resolved', resolved_at = NOW(), resolution = $1 WHERE id = $2`,
    [resolution, incidentId]
  );
}

async function detachUserFromIncidents(executor, userId) {
  const db = requireExecutor(executor);
  await db.query('UPDATE incidents SET detected_by = NULL WHERE detected_by = $1::uuid', [userId]);
  await db.query('UPDATE incidents SET resolved_by = NULL WHERE resolved_by = $1::uuid', [userId]);
}

function parseSeedDetails(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (_) { return {}; }
}

async function seedIncident(executor, values) {
  const db = requireExecutor(executor);
  if (!Array.isArray(values) || ![16, 19].includes(values.length)) {
    throw new TypeError('[seedIncident] expected 16 legacy or 19 governed positional values');
  }

  let governedValues = values;
  if (values.length === 16) {
    const incidentType = values[3];
    const details = parseSeedDetails(values[8]);
    const governance = resolveGovernanceOrThrow({
      incident_type: incidentType,
      subtype: incidentType === 'reconciliation_error' ? details.type : undefined,
    });
    governedValues = [
      ...values,
      governance.origin_domain,
      governance.resolver_domain,
      governance.resolution_class,
    ];
  }

  return db.query(`
    INSERT INTO incidents (
      id, parcel_id, order_id, incident_type, severity,
      status, title, description, details,
      client_impact, client_notified, detected_by,
      detected_source, resolution, resolved_at, resolved_by,
      origin_domain, resolver_domain, resolution_class
    ) VALUES (
      $1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12::uuid,
      $13,$14::jsonb,$15,$16,$17,$18,$19
    )`, governedValues);
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
