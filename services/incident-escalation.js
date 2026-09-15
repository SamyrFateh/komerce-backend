/**
 * @komerce-arch
 * @role          incident-sla-escalation
 * @domain        incident-management
 * @layer         service
 * @criticality   high
 * @inputs        overdue_incidents, incident_governance, caller_or_pool_transaction
 * @outputs       durable_action_center_signal, durable_escalation_marker
 * @depends       db.js, services/incident-governance.js, services/signal-service.js
 * @used-by       bootstrap/crons.js, tests/unit/incident-escalation.test.js, tests/integration/incident-f3-postgres.test.js
 * @db-read       incidents, orders, parcels
 * @db-write      incidents
 * @db-write-via:signal-service signals
 * @db-txn        per_incident_atomic_signal_and_marker
 * @doctrine      F3_INCIDENT_SLA_CONTRACT, durable_operational_recipient, no_auto_resolution
 * @impact-areas  incident-management, decision-signals, logistics, orders, purchasing, payments
 * @version       2026-09
 */
'use strict';

const pool = require('../db');
const signalService = require('./signal-service');
const { resolverDomainToOwnerRole } = require('./incident-governance');

const SIGNAL_TYPE = 'incident_sla_overdue';
const FIRST_ESCALATION_LEVEL = 1;

function recommendationFor(incident) {
  if (incident.resolution_class === 'PHYSICAL_PROOF') {
    return 'Produire une nouvelle preuve physique puis revalider le prédicat original dans la même transaction.';
  }
  if (incident.resolution_class === 'UPSTREAM_TRUTH') {
    return `Corriger la vérité authoritative dans ${incident.resolver_domain}, puis faire revalider l’invariant par Hub.`;
  }
  return 'Classifier explicitement l’autorité de résolution avant toute fermeture.';
}

function severityFor(incident) {
  if (incident.severity === 'critical') return 'critical';
  if (incident.severity === 'high') return 'critical';
  return 'warning';
}

async function loadNextOverdueIncident(client) {
  const { rows } = await client.query(`
    SELECT i.id, i.incident_type, i.severity, i.status, i.title,
           i.parcel_id, i.order_id, i.order_item_id,
           i.origin_domain, i.resolver_domain, i.resolution_class,
           i.due_at, i.escalation_level,
           COALESCE(o.market_id, po.market_id) AS market_id,
           COALESCE(o.reference, po.reference) AS order_reference,
           p.reference AS parcel_reference
      FROM incidents i
      LEFT JOIN parcels p ON p.id = i.parcel_id
      LEFT JOIN orders o ON o.id = i.order_id
      LEFT JOIN orders po ON po.id = p.order_id
     WHERE i.status IN ('open', 'investigating')
       AND i.due_at IS NOT NULL
       AND i.due_at <= NOW()
       AND i.escalation_level < $1
     ORDER BY i.due_at ASC, i.created_at ASC
     FOR UPDATE OF i SKIP LOCKED
     LIMIT 1
  `, [FIRST_ESCALATION_LEVEL]);
  return rows[0] || null;
}

async function escalateOneOverdueIncident(client) {
  const incident = await loadNextOverdueIncident(client);
  if (!incident) return null;

  const nextLevel = FIRST_ESCALATION_LEVEL;
  const ownerRole = resolverDomainToOwnerRole(incident.resolver_domain);
  const summary = [
    `Échéance ${new Date(incident.due_at).toISOString()} dépassée.`,
    `Autorité de prochaine action: ${incident.resolver_domain}.`,
    incident.order_reference ? `Commande ${incident.order_reference}.` : null,
    incident.parcel_reference ? `Colis ${incident.parcel_reference}.` : null,
  ].filter(Boolean).join(' ');

  await signalService.upsertSignal({
    signal_type: SIGNAL_TYPE,
    severity: severityFor(incident),
    title: incident.title ? `Incident SLA dépassé — ${incident.title}` : `Incident SLA dépassé — ${incident.incident_type}`,
    summary,
    source_module: 'incident-escalation',
    target_shell: 'bo',
    target_view: 'incidents',
    target_filters: { incident_id: incident.id },
    owner_role: ownerRole,
    entity_type: 'incident',
    entity_id: incident.id,
    recommendation: recommendationFor(incident),
    confidence: 'high',
    meta: {
      incident_id: incident.id,
      incident_type: incident.incident_type,
      parcel_id: incident.parcel_id || null,
      order_id: incident.order_id || null,
      order_item_id: incident.order_item_id || null,
      resolver_domain: incident.resolver_domain,
      resolution_class: incident.resolution_class,
      due_at: incident.due_at,
      escalation_level: nextLevel,
    },
    market_id: incident.market_id || null,
  }, client);

  const { rows: [updated] } = await client.query(`
    UPDATE incidents
       SET escalation_level = $2,
           updated_at = NOW()
     WHERE id = $1
       AND status IN ('open', 'investigating')
       AND escalation_level < $2
     RETURNING id, status, escalation_level
  `, [incident.id, nextLevel]);

  if (!updated) {
    const err = new Error('[incident-escalation] escalation marker lost after signal delivery');
    err.code = 'INCIDENT_ESCALATION_MARKER_RACE';
    throw err;
  }

  return {
    incident_id: incident.id,
    status: updated.status,
    escalation_level: updated.escalation_level,
    owner_role: ownerRole,
    market_id: incident.market_id || null,
  };
}

/**
 * Bounded scanner. Each incident is signal+marker atomic in its own DB
 * transaction. If Action Center persistence fails, the marker rolls back and
 * the incident remains eligible for a later retry. It never auto-resolves.
 */
async function scanOverdueIncidents({ limit = 50 } = {}) {
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  const escalated = [];

  for (let n = 0; n < boundedLimit; n += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await escalateOneOverdueIncident(client);
      if (!result) {
        await client.query('ROLLBACK');
        break;
      }
      await client.query('COMMIT');
      escalated.push(result);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  return { scanned_limit: boundedLimit, escalated_count: escalated.length, escalated };
}

module.exports = {
  SIGNAL_TYPE,
  FIRST_ESCALATION_LEVEL,
  recommendationFor,
  severityFor,
  loadNextOverdueIncident,
  escalateOneOverdueIncident,
  scanOverdueIncidents,
};
