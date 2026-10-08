/**
 * @komerce-arch
 * @role          action-center-agent-scope-service
 * @domain        decision-signals
 * @layer         service
 * @criticality   high
 * @inputs        authenticated_agent_user (role, relais_id issus de la session serveur), pagination
 * @outputs       agent_scoped_signal_projection, agent_acknowledge_snooze_result
 * @depends       db.js, services/signal-admin-service.js
 * @used-by       routes/agent-action-center.js
 * @db-read       signals, orders, parcels, operator_market_scopes
 * @db-write      signals
 * @db-txn        none
 * @doctrine      server_side_scope_is_authority, role_alone_is_not_enough, relay_scope_fail_closed, explicit_market_perimeter_for_central_roles, agent_actions_acknowledge_snooze_only, no_agent_resolve_canonical_chain_resolves, action_center_never_mutates_source_entities
 * @impact-areas  decision-signals, admin-dashboard, relay-network
 * @version       2026-10
 */

'use strict';

const db = require('../db');
const signalAdminService = require('./signal-admin-service');

// Propriétaires de signaux ouverts à chaque rôle agent. Le rôle ne suffit pas :
// agent_relais est borné à SON relais (users.relais_id) via l'entité du signal ;
// agent_hub / agent_transitaire sont bornés aux marchés explicitement rattachés
// (operator_market_scopes, non révoqués) — sans rattachement : refus (fail-closed).
const AGENT_SCOPES = Object.freeze({
  agent_hub: Object.freeze({ ownerRoles: Object.freeze(['hub']), relayBound: false, marketBound: true }),
  agent_relais: Object.freeze({ ownerRoles: Object.freeze(['relais']), relayBound: true }),
  agent_transitaire: Object.freeze({ ownerRoles: Object.freeze(['customs']), relayBound: false, marketBound: true }),
});

const MAX_LIMIT = 100;
const MAX_AGENT_SNOOZE_HOURS = 24;

function httpError(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

async function resolveScope(user) {
  const scope = user && AGENT_SCOPES[user.role];
  if (!scope) throw httpError(403, 'Rôle sans accès à l’Action Center agent', 'agent_action_center_role_forbidden');
  if (scope.relayBound && !user.relais_id) {
    throw httpError(403, 'Aucun relais rattaché à cet agent', 'agent_action_center_relay_scope_missing');
  }
  let marketIds = null;
  if (scope.marketBound) {
    const { rows } = await db.query(
      'SELECT market_id FROM operator_market_scopes WHERE user_id = $1 AND revoked_at IS NULL',
      [user.id]
    );
    marketIds = rows.map(r => r.market_id);
    if (marketIds.length === 0) {
      throw httpError(403, 'Aucun marché rattaché à cet agent', 'agent_action_center_market_scope_missing');
    }
  }
  return { ownerRoles: scope.ownerRoles, relaisId: scope.relayBound ? user.relais_id : null, marketIds };
}

function normalizePage(query = {}) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), MAX_LIMIT);
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
  return { limit, offset };
}

// Actions agent autorisées : acquitter / reporter uniquement. Jamais « résoudre » : la résolution
// reste décidée par la chaîne canonique (auto-résolution sur preuve/réconciliation).
function allowedActions(status) {
  if (status === 'open') return ['acknowledge', 'snooze'];
  if (status === 'acknowledged') return ['snooze'];
  return [];
}

// Projection volontairement réduite : pas de href vers des écrans admin.
function publicSignal(row) {
  return {
    signal_ref: row.signal_ref,
    signal_type: row.signal_type,
    severity: row.severity,
    title: row.title,
    summary: row.summary || null,
    recommendation: row.recommendation || null,
    owner_role: row.owner_role,
    status: row.status,
    created_at: row.created_at,
    entity_type: row.entity_type || null,
    actions: allowedActions(row.status),
  };
}

const SCOPE_SQL = `
  s.owner_role = ANY($1::text[])
  AND s.status IN ('open','acknowledged')
  AND ($3::uuid[] IS NULL OR s.market_id = ANY($3::uuid[]))
  AND (
    $2::uuid IS NULL
    OR (s.entity_type = 'order' AND EXISTS (
          SELECT 1 FROM orders o WHERE o.id::text = s.entity_id::text AND o.relais_id = $2::uuid))
    OR (s.entity_type = 'parcel' AND EXISTS (
          SELECT 1 FROM parcels p WHERE p.id::text = s.entity_id::text AND p.relais_id = $2::uuid))
  )`;

async function listForAgent(user, query = {}) {
  const { ownerRoles, relaisId, marketIds } = await resolveScope(user);
  const { limit, offset } = normalizePage(query);
  const { rows } = await db.query(
    `SELECT s.signal_ref, s.signal_type, s.severity, s.title, s.summary, s.recommendation,
            s.owner_role, s.status, s.created_at, s.entity_type
       FROM signals s
      WHERE ${SCOPE_SQL}
      ORDER BY CASE s.severity WHEN 'urgent' THEN 1 WHEN 'critical' THEN 2 WHEN 'warning' THEN 3 ELSE 4 END,
               s.created_at DESC
      LIMIT $4 OFFSET $5`,
    [ownerRoles, relaisId, marketIds, limit, offset]
  );
  const { rows: [count] } = await db.query(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE s.severity IN ('urgent','critical')) AS urgent,
            COUNT(*) FILTER (WHERE s.severity = 'warning') AS warning,
            COUNT(*) FILTER (WHERE s.severity NOT IN ('urgent','critical','warning')) AS info
       FROM signals s WHERE ${SCOPE_SQL}`,
    [ownerRoles, relaisId, marketIds]
  );
  const total = Number(count.total) || 0;
  return {
    role: user.role,
    owner_roles: ownerRoles,
    relay_bound: Boolean(relaisId),
    total,
    summary: { urgent: Number(count.urgent) || 0, warning: Number(count.warning) || 0, info: Number(count.info) || 0, total_active: total },
    signals: rows.map(publicSignal),
  };
}

async function findInScope(user, signalRef) {
  const { ownerRoles, relaisId, marketIds } = await resolveScope(user);
  const { rows } = await db.query(
    `SELECT s.signal_ref, s.status, s.market_id FROM signals s WHERE ${SCOPE_SQL} AND s.signal_ref = $4 LIMIT 1`,
    [ownerRoles, relaisId, marketIds, String(signalRef || '')]
  );
  if (!rows[0]) throw httpError(404, 'Signal introuvable dans votre périmètre', 'agent_action_center_signal_not_in_scope');
  return rows[0];
}

async function acknowledge(user, signalRef) {
  const row = await findInScope(user, signalRef);
  const done = await signalAdminService.acknowledgeByRef(row.signal_ref, row.market_id);
  if (!done) throw httpError(409, 'Signal non acquittable dans son état actuel', 'agent_action_center_action_not_allowed');
  return { signal_ref: done.signal_ref, status: done.status, actions: allowedActions(done.status) };
}

async function snooze(user, signalRef, rawHours) {
  const hours = Number(rawHours === undefined ? MAX_AGENT_SNOOZE_HOURS : rawHours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_AGENT_SNOOZE_HOURS) {
    throw httpError(400, `Report limité à ${MAX_AGENT_SNOOZE_HOURS} h`, 'agent_action_center_snooze_out_of_range');
  }
  const row = await findInScope(user, signalRef);
  const done = await signalAdminService.snoozeByRef(row.signal_ref, hours, row.market_id);
  if (!done) throw httpError(409, 'Signal non reportable dans son état actuel', 'agent_action_center_action_not_allowed');
  return { signal_ref: done.signal_ref, status: done.status, snoozed_until: done.snoozed_until, actions: allowedActions(done.status) };
}

module.exports = { AGENT_SCOPES, MAX_AGENT_SNOOZE_HOURS, resolveScope, normalizePage, publicSignal, allowedActions, listForAgent, acknowledge, snooze };
