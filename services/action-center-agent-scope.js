/**
 * @komerce-arch
 * @role          action-center-agent-scope-service
 * @domain        decision-signals
 * @layer         service
 * @criticality   high
 * @inputs        authenticated_agent_user (role, relais_id issus de la session serveur), pagination
 * @outputs       agent_scoped_signal_projection
 * @depends       db.js
 * @used-by       routes/agent-action-center.js
 * @db-read       signals, orders, parcels
 * @db-write      none
 * @db-txn        none
 * @doctrine      server_side_scope_is_authority, role_alone_is_not_enough, relay_scope_fail_closed, read_only_projection, action_center_never_mutates_source_entities
 * @impact-areas  decision-signals, admin-dashboard, relay-network
 * @version       2026-10
 */

'use strict';

const db = require('../db');

// Propriétaires de signaux ouverts à chaque rôle agent. Le rôle ne suffit pas :
// agent_relais est en plus borné à SON relais (users.relais_id) via l'entité du signal.
const AGENT_SCOPES = Object.freeze({
  agent_hub: Object.freeze({ ownerRoles: Object.freeze(['hub']), relayBound: false }),
  agent_relais: Object.freeze({ ownerRoles: Object.freeze(['relais']), relayBound: true }),
  agent_transitaire: Object.freeze({ ownerRoles: Object.freeze(['customs']), relayBound: false }),
});

const MAX_LIMIT = 100;

function httpError(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

function resolveScope(user) {
  const scope = user && AGENT_SCOPES[user.role];
  if (!scope) throw httpError(403, 'Rôle sans accès à l’Action Center agent', 'agent_action_center_role_forbidden');
  if (scope.relayBound && !user.relais_id) {
    throw httpError(403, 'Aucun relais rattaché à cet agent', 'agent_action_center_relay_scope_missing');
  }
  return { ownerRoles: scope.ownerRoles, relaisId: scope.relayBound ? user.relais_id : null };
}

function normalizePage(query = {}) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), MAX_LIMIT);
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
  return { limit, offset };
}

// Projection volontairement réduite : pas de href vers des écrans admin, pas d'actions (lecture seule).
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
    actions: [],
  };
}

const SCOPE_SQL = `
  s.owner_role = ANY($1::text[])
  AND s.status IN ('open','acknowledged')
  AND (
    $2::uuid IS NULL
    OR (s.entity_type = 'order' AND EXISTS (
          SELECT 1 FROM orders o WHERE o.id::text = s.entity_id::text AND o.relais_id = $2::uuid))
    OR (s.entity_type = 'parcel' AND EXISTS (
          SELECT 1 FROM parcels p WHERE p.id::text = s.entity_id::text AND p.relais_id = $2::uuid))
  )`;

async function listForAgent(user, query = {}) {
  const { ownerRoles, relaisId } = resolveScope(user);
  const { limit, offset } = normalizePage(query);
  const { rows } = await db.query(
    `SELECT s.signal_ref, s.signal_type, s.severity, s.title, s.summary, s.recommendation,
            s.owner_role, s.status, s.created_at, s.entity_type
       FROM signals s
      WHERE ${SCOPE_SQL}
      ORDER BY CASE s.severity WHEN 'urgent' THEN 1 WHEN 'critical' THEN 2 WHEN 'warning' THEN 3 ELSE 4 END,
               s.created_at DESC
      LIMIT $3 OFFSET $4`,
    [ownerRoles, relaisId, limit, offset]
  );
  const { rows: [count] } = await db.query(`SELECT COUNT(*) AS count FROM signals s WHERE ${SCOPE_SQL}`, [ownerRoles, relaisId]);
  return { role: user.role, owner_roles: ownerRoles, relay_bound: Boolean(relaisId), total: Number(count.count) || 0, signals: rows.map(publicSignal) };
}

module.exports = { AGENT_SCOPES, resolveScope, normalizePage, publicSignal, listForAgent };
