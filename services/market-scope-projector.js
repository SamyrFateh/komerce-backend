/**
 * @komerce-arch
 * @role          market-delegation-scope-projector
 * @domain        market-delegation
 * @layer         service
 * @criticality   high
 * @inputs        market_operating_assignments, assignment_memberships, membership_capabilities
 * @outputs       desired market authorization projection
 * @depends       services/market-scope-admin-service.js
 * @used-by       market-delegation mutations
 * @db-read       market_operating_assignments, assignment_capability_ceiling, assignment_memberships, membership_capabilities, capability_registry
 * @db-write      none
 * @db-txn        caller-owned
 * @doctrine      operator_market_scopes_is_market_owned_projection, granular_members_fail_closed_on_legacy_roles
 * @impact-areas  market, authorization, delegation
 * @version       2026-09
 */
'use strict';

const {
  upsertProjectedMarketScope,
  revokeProjectedMarketScopes,
  listProjectedMarketScopes,
} = require('./market-scope-admin-service');

// Compatibility contract for legacy routes that still understand only
// viewer/manager. A granular membership receives NO legacy scope unless it
// owns this complete read baseline. This prevents an empty/team-only
// membership from gaining broad read access simply because it exists.
const LEGACY_VIEWER_CAPABILITIES = Object.freeze([
  'pricing.read',
  'pricing.simulate',
  'dashboard.market.read',
  'operations.read',
  'client.read',
  'network.read',
  'market_config.read',
  'finance.read',
]);

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') throw new TypeError('market-scope-projector: executor.query requis');
  return executor;
}

async function desiredScopesForAssignment(db, assignmentId) {
  const { rows } = await db.query(
    `SELECT a.id AS assignment_id,
            a.market_id,
            a.status AS assignment_status,
            am.id AS membership_id,
            am.user_id,
            CASE WHEN EXISTS (
              SELECT 1
                FROM assignment_capability_ceiling acc_any
                JOIN capability_registry registry_any
                  ON registry_any.capability = acc_any.capability
               WHERE acc_any.assignment_id = a.id
                 AND acc_any.revoked_at IS NULL
                 AND registry_any.class = 'DELEGATION'
                 AND registry_any.authority_scope = 'MARKET'
                 AND registry_any.delegation_mode = 'DELEGABLE'
                 AND registry_any.status = 'LIVE'
            ) AND NOT EXISTS (
              SELECT 1
                FROM assignment_capability_ceiling acc
                JOIN capability_registry registry
                  ON registry.capability = acc.capability
               WHERE acc.assignment_id = a.id
                 AND acc.revoked_at IS NULL
                 AND registry.class = 'DELEGATION'
                 AND registry.authority_scope = 'MARKET'
                 AND registry.delegation_mode = 'DELEGABLE'
                 AND registry.status = 'LIVE'
                 AND NOT EXISTS (
                   SELECT 1
                     FROM membership_capabilities mc
                    WHERE mc.membership_id = am.id
                      AND mc.capability = acc.capability
                      AND mc.revoked_at IS NULL
                 )
            ) THEN 'manager' ELSE 'viewer' END AS scope_role
       FROM market_operating_assignments a
       JOIN assignment_memberships am ON am.assignment_id = a.id
      WHERE a.id = $1::uuid
        AND a.status = 'ACTIVE'
        AND am.status = 'ACTIVE'
        AND NOT EXISTS (
          SELECT 1
            FROM unnest($2::text[]) AS required(capability)
           WHERE NOT EXISTS (
             SELECT 1
               FROM membership_capabilities mc_required
              WHERE mc_required.membership_id = am.id
                AND mc_required.capability = required.capability
                AND mc_required.revoked_at IS NULL
           )
        )`,
    [assignmentId, LEGACY_VIEWER_CAPABILITIES]
  );
  return rows;
}

async function assignmentState(db, assignmentId) {
  const { rows } = await db.query(
    `SELECT a.id,
            a.market_id,
            a.status,
            COALESCE(array_agg(am.id) FILTER (WHERE am.id IS NOT NULL), ARRAY[]::uuid[]) AS membership_ids
       FROM market_operating_assignments a
       LEFT JOIN assignment_memberships am ON am.assignment_id = a.id
      WHERE a.id = $1::uuid
      GROUP BY a.id, a.market_id, a.status`,
    [assignmentId]
  );
  return rows[0] || null;
}

async function projectAssignment(executor, assignmentId) {
  const db = requireExecutor(executor);
  const assignment = await assignmentState(db, assignmentId);
  if (!assignment) throw new Error('market_scope_projector_assignment_not_found');

  const allMembershipIds = assignment.membership_ids || [];
  if (assignment.status !== 'ACTIVE') {
    await revokeProjectedMarketScopes(db, { membershipIds: allMembershipIds });
    return [];
  }

  const desired = await desiredScopesForAssignment(db, assignmentId);
  const desiredMembershipIds = desired.map(row => row.membership_id);
  await revokeProjectedMarketScopes(db, {
    membershipIds: allMembershipIds,
    exceptMembershipIds: desiredMembershipIds,
  });

  for (const scope of desired) {
    await upsertProjectedMarketScope(db, {
      userId: scope.user_id,
      marketId: scope.market_id,
      scopeRole: scope.scope_role,
      membershipId: scope.membership_id,
    });
  }
  return desired;
}

async function projectionDrift(executor, assignmentId) {
  const db = requireExecutor(executor);
  const assignment = await assignmentState(db, assignmentId);
  if (!assignment) throw new Error('market_scope_projector_assignment_not_found');
  const desired = assignment.status === 'ACTIVE'
    ? await desiredScopesForAssignment(db, assignmentId)
    : [];
  const actual = await listProjectedMarketScopes(db, {
    membershipIds: assignment.membership_ids || [],
  });
  const normalize = rows => rows.map(row => ({
    user_id: String(row.user_id),
    market_id: String(row.market_id),
    scope_role: row.scope_role,
    membership_id: String(row.membership_id),
  })).sort((a, b) => a.membership_id.localeCompare(b.membership_id));
  const wanted = normalize(desired);
  const got = normalize(actual);
  return { ok: JSON.stringify(wanted) === JSON.stringify(got), desired: wanted, actual: got };
}

module.exports = {
  LEGACY_VIEWER_CAPABILITIES,
  desiredScopesForAssignment,
  assignmentState,
  projectAssignment,
  projectionDrift,
};
