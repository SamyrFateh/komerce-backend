/**
 * @komerce-arch
 * @role          incident-management-transition-guard
 * @domain        incident-management
 * @layer         service
 * @criticality   high
 * @inputs        parcel_id, target_status
 * @outputs       throws on blocked transition, resolves {allowed:true} otherwise
 * @depends       db, services/incident-governance
 * @used-by       services/parcel-operations.js#transitionParcelStatus
 * @db-read       incidents, parcels
 * @db-write      none
 * @db-txn        caller_owned_queryable
 * @doctrine      F2_INCIDENT_GOVERNANCE_CONTRACT
 * @impact-areas  incident-management, logistics
 * @version       2026-09
 */
'use strict';

const pool = require('../db');
const { isIrreversibleTransitionBlocked } = require('./incident-governance');

const IRREVERSIBLE_HUB_TRANSITIONS = new Set(['shipped']);

async function assertParcelTransitionAllowed(parcelId, targetStatus, executor = pool) {
  // F2 only governs irreversible outward physical transitions. Receiving,
  // inspection, evidence addition and reversible/local transitions must stay
  // possible so an incident can actually be investigated and resolved.
  if (!IRREVERSIBLE_HUB_TRANSITIONS.has(targetStatus)) return { allowed: true };

  const db = executor && typeof executor.query === 'function' ? executor : pool;

  const { rows } = await db.query(
    `SELECT i.incident_type, i.origin_domain, i.details
     FROM parcels p
     JOIN incidents i
       ON i.parcel_id = p.id
       OR (i.parcel_id IS NULL AND i.order_id = p.order_id)
     WHERE p.id = $1
       AND i.status IN ('open', 'investigating')`,
    [parcelId]
  );

  const openIncidents = (rows || []).map((row) => ({
    incident_type: row.incident_type,
    origin_domain: row.origin_domain,
    subtype: row.details && row.details.type,
  }));

  const result = isIrreversibleTransitionBlocked(openIncidents, targetStatus);
  if (result.blocked) {
    const err = new Error(
      `[incident-governance] transition parcel ${parcelId} -> ${targetStatus} bloquée ` +
      `(reason=${result.reason}` +
      `${result.incident ? ', incident_type=' + result.incident.incident_type : ''}).`
    );
    err.code = result.reason;
    err.incident = result.incident;
    throw err;
  }

  return { allowed: true };
}

module.exports = { assertParcelTransitionAllowed };
