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
 * @db-read       incidents, order_items, parcel_items, parcels
 * @db-write      none
 * @db-txn        caller_owned_queryable
 * @doctrine      F2_INCIDENT_GOVERNANCE_CONTRACT, HUB-001_PHYSICAL_IDENTITY_ALLOCATION_CUSTODY
 * @impact-areas  incident-management, logistics
 * @version       2026-09
 */
'use strict';

const pool = require('../db');
const { isIrreversibleTransitionBlocked } = require('./incident-governance');

const IRREVERSIBLE_HUB_TRANSITIONS = new Set(['shipped']);

async function assertParcelTransitionAllowed(parcelId, targetStatus, executor = pool) {
  if (!IRREVERSIBLE_HUB_TRANSITIONS.has(targetStatus)) return { allowed: true };

  const db = executor && typeof executor.query === 'function' ? executor : pool;

  // HUB-001 : `parcels.order_id` n'est qu'une ancre historique. Un Market
  // Parcel peut contenir plusieurs commandes compatibles. La portée incidente
  // réelle vient donc de la membership parcel_items -> order_items, plus :
  // - incident directement lié au parcel ;
  // - incident lié à un order_item du parcel ;
  // - incident order-level de TOUTE commande représentée dans le parcel ;
  // - l'order d'ancrage pour compat legacy.
  const { rows } = await db.query(`
    WITH parcel_scope AS (
      SELECT p.id AS parcel_id, p.order_id AS anchor_order_id
        FROM parcels p
       WHERE p.id = $1
    ),
    member_items AS (
      SELECT DISTINCT pi.order_item_id, oi.order_id
        FROM parcel_items pi
        JOIN order_items oi ON oi.id = pi.order_item_id
       WHERE pi.parcel_id = $1
    ),
    member_orders AS (
      SELECT order_id FROM member_items
      UNION
      SELECT anchor_order_id FROM parcel_scope WHERE anchor_order_id IS NOT NULL
    )
    SELECT DISTINCT i.incident_type, i.origin_domain, i.details
      FROM incidents i
      CROSS JOIN parcel_scope ps
     WHERE i.status IN ('open', 'investigating')
       AND (
         i.parcel_id = ps.parcel_id
         OR (i.order_item_id IS NOT NULL AND i.order_item_id IN (SELECT order_item_id FROM member_items))
         OR (i.parcel_id IS NULL AND i.order_id IS NOT NULL AND i.order_id IN (SELECT order_id FROM member_orders))
       )
  `, [parcelId]);

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
