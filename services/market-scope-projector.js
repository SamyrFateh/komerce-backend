/**
 * @komerce-arch
 * @role          market-delegation-scope-projector
 * @domain        market
 * @layer         service
 * @criticality   high
 * @inputs        market_operating_assignments, assignment_memberships, membership_capabilities
 * @outputs       operator_market_scopes read model
 * @depends       none
 * @used-by       market-delegation mutations
 * @db-read       market_operating_assignments, assignment_memberships, membership_capabilities, capability_registry, operator_market_scopes
 * @db-write      operator_market_scopes
 * @db-txn        caller-owned
 * @doctrine      operator_market_scopes_is_projection
 * @impact-areas  market, authorization, delegation
 * @version       2026-09
 */
'use strict';

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
                FROM membership_capabilities mc
                JOIN capability_registry cr ON cr.capability = mc.capability
               WHERE mc.membership_id = am.id
                 AND mc.revoked_at IS NULL
                 AND cr.authority_scope = 'MARKET'
                 AND cr.requires_audit = TRUE
            ) THEN 'manager' ELSE 'viewer' END AS scope_role
       FROM market_operating_assignments a
       JOIN assignment_memberships am ON am.assignment_id = a.id
      WHERE a.id = $1::uuid
        AND a.status = 'ACTIVE'
        AND am.status = 'ACTIVE'`,
    [assignmentId]
  );
  return rows;
}

async function projectAssignment(executor, assignmentId) {
  const db = requireExecutor(executor);
  const desired = await desiredScopesForAssignment(db, assignmentId);
  const { rows: assignmentRows } = await db.query(
    `SELECT id, market_id, status FROM market_operating_assignments WHERE id=$1::uuid LIMIT 1`,
    [assignmentId]
  );
  const assignment = assignmentRows[0];
  if (!assignment) throw new Error('market_scope_projector_assignment_not_found');

  if (assignment.status !== 'ACTIVE') {
    await db.query(
      `UPDATE operator_market_scopes oms
          SET revoked_at = NOW(), revoked_by = NULL
        WHERE oms.revoked_at IS NULL
          AND oms.projected_from_membership_id IN (
            SELECT id FROM assignment_memberships WHERE assignment_id=$1::uuid
          )`,
      [assignmentId]
    );
    return [];
  }

  const desiredMembershipIds = desired.map(row => row.membership_id);
  await db.query(
    `UPDATE operator_market_scopes oms
        SET revoked_at = NOW(), revoked_by = NULL
      WHERE oms.revoked_at IS NULL
        AND oms.projected_from_membership_id IN (
          SELECT id FROM assignment_memberships WHERE assignment_id=$1::uuid
        )
        AND NOT (oms.projected_from_membership_id = ANY($2::uuid[]))`,
    [assignmentId, desiredMembershipIds]
  );

  for (const scope of desired) {
    const { rows: activeRows } = await db.query(
      `SELECT id, projected_from_membership_id
         FROM operator_market_scopes
        WHERE user_id=$1::uuid AND market_id=$2::uuid AND revoked_at IS NULL
        LIMIT 1
        FOR UPDATE`,
      [scope.user_id, scope.market_id]
    );
    const active = activeRows[0];
    if (active) {
      await db.query(
        `UPDATE operator_market_scopes
            SET role=$2,
                projected_from_membership_id=$3::uuid
          WHERE id=$1::uuid`,
        [active.id, scope.scope_role, scope.membership_id]
      );
    } else {
      await db.query(
        `INSERT INTO operator_market_scopes
          (user_id, market_id, role, granted_by, projected_from_membership_id)
         VALUES ($1::uuid,$2::uuid,$3,NULL,$4::uuid)`,
        [scope.user_id, scope.market_id, scope.scope_role, scope.membership_id]
      );
    }
  }
  return desired;
}

async function projectionDrift(executor, assignmentId) {
  const db = requireExecutor(executor);
  const desired = await desiredScopesForAssignment(db, assignmentId);
  const { rows: actual } = await db.query(
    `SELECT oms.user_id, oms.market_id, oms.role AS scope_role, oms.projected_from_membership_id AS membership_id
       FROM operator_market_scopes oms
       JOIN assignment_memberships am ON am.id = oms.projected_from_membership_id
      WHERE am.assignment_id=$1::uuid AND oms.revoked_at IS NULL
      ORDER BY oms.user_id`,
    [assignmentId]
  );
  const normalize = rows => rows.map(row => ({
    user_id: String(row.user_id), market_id: String(row.market_id), scope_role: row.scope_role, membership_id: String(row.membership_id),
  })).sort((a,b) => a.membership_id.localeCompare(b.membership_id));
  const wanted = normalize(desired);
  const got = normalize(actual);
  return { ok: JSON.stringify(wanted) === JSON.stringify(got), desired: wanted, actual: got };
}

module.exports = { desiredScopesForAssignment, projectAssignment, projectionDrift };
