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
 * @db-read       incidents, scan_events
 * @db-write      incidents
 * @db-txn        caller_owned_queryable
 * @doctrine      lifecycle_owner_boundary, preserve_caller_transaction, F2_INCIDENT_GOVERNANCE_CONTRACT, F3_PROOF_REVALIDATION_CONTRACT
 * @impact-areas  incident-management, logistics, payments, notifications, dashboard, platform-ops
 * @version       2026-09
 */
'use strict';

const { resolveGovernanceOrThrow, assertTerminalResolutionAllowed, computeDueAt } = require('./incident-governance');

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
      origin_domain, resolver_domain, resolution_class, due_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    RETURNING *
  `, [
    params.parcel_id || null, params.order_id || null,
    params.order_item_id || null, params.scan_event_id || null,
    params.incident_type, params.severity || 'medium', params.title,
    params.description || null, JSON.stringify(params.details || {}),
    params.client_impact || 'none', params.detected_by || null,
    params.detected_source || 'system', governance.origin_domain,
    governance.resolver_domain, governance.resolution_class,
    computeDueAt(governance.resolution_class),
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
      origin_domain, resolver_domain, resolution_class, due_at
    ) VALUES ($1,$2,$3,'reconciliation_error',$4,$5,$6,$7,'reconciliation',$8,$9,$10,$11)
    RETURNING *
  `, [
    parcelId, orderId, orderItemId, issue.severity, issue.message, issue.message,
    JSON.stringify({ ...issue.details, type: issue.type }), governance.origin_domain,
    governance.resolver_domain, governance.resolution_class,
    computeDueAt(governance.resolution_class),
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
      origin_domain, resolver_domain, resolution_class, due_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,'system',$8,$9,$10,$11)
    RETURNING *
  `, [
    parcelId, orderId, incidentType, severity || 'medium',
    description || type, description || null, JSON.stringify(details),
    governance.origin_domain, governance.resolver_domain, governance.resolution_class,
    computeDueAt(governance.resolution_class),
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

/**
 * F3 — seule boundary terminale pour un incident PHYSICAL_PROOF.
 *
 * Le caller (Logistics) fournit la fonction de revalidation du prédicat qu'il
 * possède. Cette fonction est exécutée avec le MEME executor transactionnel,
 * après preuve que `proofScanEventId` est une nouvelle preuve append-only du
 * même colis. Aucune écriture n'est faite dans scan_events.
 *
 * Retourne { resolved:false, reason:'PREDICATE_STILL_FAILS' } si la nouvelle
 * preuve ne rétablit pas l'invariant. L'incident reste alors OPEN/INVESTIGATING.
 */
async function resolvePhysicalProofIncident(executor, {
  incidentId,
  proofScanEventId,
  revalidate,
  resolvedBy = null,
  notes = null,
}) {
  const db = requireExecutor(executor);
  if (typeof revalidate !== 'function') {
    throw new TypeError('[resolvePhysicalProofIncident] revalidate(executor, context) is required');
  }

  const { rows: [incident] } = await db.query(`
    SELECT i.*, trigger_scan.created_at AS trigger_scan_created_at
      FROM incidents i
      LEFT JOIN scan_events trigger_scan ON trigger_scan.id = i.scan_event_id
     WHERE i.id = $1
     FOR UPDATE OF i
  `, [incidentId]);

  if (!incident) {
    const err = new Error('[resolvePhysicalProofIncident] incident not found');
    err.code = 'INCIDENT_NOT_FOUND';
    throw err;
  }
  if (!['open', 'investigating'].includes(incident.status)) {
    const err = new Error('[resolvePhysicalProofIncident] incident is not active');
    err.code = 'INCIDENT_NOT_ACTIVE';
    throw err;
  }
  if (
    incident.origin_domain !== 'LOGISTICS' ||
    incident.resolver_domain !== 'LOGISTICS' ||
    incident.resolution_class !== 'PHYSICAL_PROOF'
  ) {
    const err = new Error('[resolvePhysicalProofIncident] resolver authority is not Logistics/PHYSICAL_PROOF');
    err.code = 'INCIDENT_RESOLVER_AUTHORITY_MISMATCH';
    throw err;
  }
  if (!incident.parcel_id) {
    const err = new Error('[resolvePhysicalProofIncident] physical incident has no parcel_id');
    err.code = 'PHYSICAL_INCIDENT_WITHOUT_PARCEL';
    throw err;
  }

  const { rows: [proof] } = await db.query(`
    SELECT id, parcel_id, event_type, status, created_at, corrects_event_id,
           photo_urls, notes
      FROM scan_events
     WHERE id = $1
       AND parcel_id = $2
  `, [proofScanEventId, incident.parcel_id]);

  if (!proof) {
    const err = new Error('[resolvePhysicalProofIncident] proof scan does not belong to incident parcel');
    err.code = 'PHYSICAL_PROOF_SCOPE_MISMATCH';
    throw err;
  }

  const floor = incident.trigger_scan_created_at || incident.created_at;
  if (!proof.created_at || !floor || new Date(proof.created_at) <= new Date(floor)) {
    const err = new Error('[resolvePhysicalProofIncident] stale proof cannot resolve incident');
    err.code = 'STALE_PHYSICAL_PROOF';
    throw err;
  }

  const predicate = await revalidate(db, { incident, proof });
  if (predicate !== true) {
    return { resolved: false, reason: 'PREDICATE_STILL_FAILS', incident_id: incident.id, proof_scan_event_id: proof.id };
  }

  const resolution = {
    type: 'physical_proof_revalidated',
    proof_scan_event_id: proof.id,
    proof_event_type: proof.event_type,
    revalidated_at: new Date().toISOString(),
    notes: notes || null,
  };
  const { rows: [resolved] } = await db.query(`
    UPDATE incidents
       SET status = 'resolved',
           resolution_type = 'auto_resolved',
           resolution = $2::jsonb,
           resolved_at = NOW(),
           resolved_by = $3,
           updated_at = NOW()
     WHERE id = $1
       AND status IN ('open', 'investigating')
     RETURNING *
  `, [incident.id, JSON.stringify(resolution), resolvedBy]);

  return {
    resolved: Boolean(resolved),
    incident: resolved || null,
    proof_scan_event_id: proof.id,
  };
}

/**
 * F3 — boundary terminale pour UPSTREAM_TRUTH après correction authoritative.
 *
 * Incident Management ne corrige JAMAIS la vérité amont. Le domaine owner
 * effectue d'abord sa mutation via sa propre boundary. Hub/Logistics fournit
 * ensuite un prédicat de revalidation qui RELIT cette vérité durable avec le
 * même executor. Seul un résultat strictement `true` autorise la fermeture.
 */
async function resolveUpstreamTruthIncident(executor, {
  incidentId,
  revalidate,
  resolvedBy = null,
  notes = null,
}) {
  const db = requireExecutor(executor);
  if (typeof revalidate !== 'function') {
    throw new TypeError('[resolveUpstreamTruthIncident] revalidate(executor, context) is required');
  }

  const { rows: [incident] } = await db.query(`
    SELECT *
      FROM incidents
     WHERE id = $1
     FOR UPDATE
  `, [incidentId]);

  if (!incident) {
    const err = new Error('[resolveUpstreamTruthIncident] incident not found');
    err.code = 'INCIDENT_NOT_FOUND';
    throw err;
  }
  if (!['open', 'investigating'].includes(incident.status)) {
    const err = new Error('[resolveUpstreamTruthIncident] incident is not active');
    err.code = 'INCIDENT_NOT_ACTIVE';
    throw err;
  }
  if (incident.resolution_class !== 'UPSTREAM_TRUTH' || !incident.resolver_domain || incident.resolver_domain === 'UNCLASSIFIED') {
    const err = new Error('[resolveUpstreamTruthIncident] incident does not have proven UPSTREAM_TRUTH resolver authority');
    err.code = 'INCIDENT_RESOLVER_AUTHORITY_MISMATCH';
    throw err;
  }

  const predicate = await revalidate(db, { incident });
  if (predicate !== true) {
    return { resolved: false, reason: 'PREDICATE_STILL_FAILS', incident_id: incident.id };
  }

  const resolution = {
    type: 'upstream_truth_revalidated',
    resolver_domain: incident.resolver_domain,
    revalidated_at: new Date().toISOString(),
    notes: notes || null,
  };
  const { rows: [resolved] } = await db.query(`
    UPDATE incidents
       SET status = 'resolved',
           resolution_type = 'auto_resolved',
           resolution = $2::jsonb,
           resolved_at = NOW(),
           resolved_by = $3,
           updated_at = NOW()
     WHERE id = $1
       AND status IN ('open', 'investigating')
     RETURNING *
  `, [incident.id, JSON.stringify(resolution), resolvedBy]);

  return {
    resolved: Boolean(resolved),
    incident: resolved || null,
    resolver_domain: incident.resolver_domain,
  };
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

  const incidentType = values[3];
  const details = parseSeedDetails(values[8]);
  const subtype = incidentType === 'reconciliation_error' ? details.type : undefined;
  let governedValues;

  if (values.length === 16) {
    const governance = resolveGovernanceOrThrow({ incident_type: incidentType, subtype });
    governedValues = [
      ...values,
      governance.origin_domain,
      governance.resolver_domain,
      governance.resolution_class,
    ];
  } else {
    const governance = resolveGovernanceOrThrow({
      incident_type: incidentType,
      subtype,
      origin_domain: values[16],
      resolver_domain: values[17],
      resolution_class: values[18],
    });
    governedValues = [
      ...values.slice(0, 16),
      governance.origin_domain,
      governance.resolver_domain,
      governance.resolution_class,
    ];
  }

  const dueAt = computeDueAt(governedValues[18]);
  if (!dueAt) {
    const err = new Error('[seedIncident] governed incident requires a canonical SLA deadline');
    err.code = 'INCIDENT_DUE_AT_REQUIRED';
    throw err;
  }

  return db.query(`
    INSERT INTO incidents (
      id, parcel_id, order_id, incident_type, severity,
      status, title, description, details,
      client_impact, client_notified, detected_by,
      detected_source, resolution, resolved_at, resolved_by,
      origin_domain, resolver_domain, resolution_class, due_at
    ) VALUES (
      $1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12::uuid,
      $13,$14::jsonb,$15,$16,$17,$18,$19,$20
    )`, [...governedValues, dueAt]);
}

module.exports = {
  createScanIncident,
  createReconciliationIncident,
  createAlertEngineIncidentIfNew,
  acknowledgeAlertEngineIncident,
  resolveOpsIncident,
  resolvePhysicalProofIncident,
  resolveUpstreamTruthIncident,
  detachUserFromIncidents,
  seedIncident,
};
