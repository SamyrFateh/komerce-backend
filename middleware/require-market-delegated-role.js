/**
 * @komerce-arch
 * @role          market-delegation-runtime-role-bridge
 * @domain        market-delegation
 * @layer         middleware
 * @criticality   high
 * @inputs        authenticated user, coarse roles already accepted by the route, active projected memberships
 * @outputs       optional request-local market_operator role before canonical requireRole guard
 * @depends       db.js
 * @used-by       routes that already admit market_operator
 * @db-read       operator_market_scopes, assignment_memberships, market_operating_assignments
 * @db-write      none
 * @db-txn        none
 * @doctrine      users_role_is_not_market_authority, delegated_role_is_request_local_projection, canonical_role_guard_remains_explicit
 * @impact-areas  market-delegation, authorization, admin-dashboard
 * @version       2026-09
 */
'use strict';

const db = require('../db');

async function hasActiveProjectedMarketDelegation(userId) {
  if (!userId) return false;
  const { rows } = await db.query(
    `SELECT 1
       FROM operator_market_scopes oms
       JOIN assignment_memberships am
         ON am.id = oms.projected_from_membership_id
        AND am.user_id = oms.user_id
        AND am.status = 'ACTIVE'
       JOIN market_operating_assignments assignment
         ON assignment.id = am.assignment_id
        AND assignment.market_id = oms.market_id
        AND assignment.status = 'ACTIVE'
      WHERE oms.user_id = $1::uuid
        AND oms.revoked_at IS NULL
        AND oms.projected_from_membership_id IS NOT NULL
      LIMIT 1`,
    [userId]
  );
  return Boolean(rows[0]);
}

/**
 * Request-local pre-guard for an existing coarse role boundary.
 *
 * The caller passes exactly the roles already admitted by its canonical
 * `requireRole([...])`. If the persisted role is already one of them, nothing
 * changes. Otherwise, and only when `market_operator` belongs to that existing
 * allow-list, an active membership projection can provide the compatibility
 * role for this request. The canonical requireRole call remains immediately
 * downstream and remains visible to Security 360.
 *
 * No users.role mutation occurs.
 */
function attachMarketDelegatedRoleFor(roles) {
  const allowed = Object.freeze(Array.isArray(roles) ? [...roles] : []);

  return async (req, res, next) => {
    if (!req.user || allowed.includes(req.user.role) || !allowed.includes('market_operator')) {
      return next();
    }

    try {
      const delegated = await hasActiveProjectedMarketDelegation(req.user.id);
      if (!delegated) return next();

      const persistedRole = req.user.role;
      req.user = {
        ...req.user,
        persisted_role: persistedRole,
        role: 'market_operator',
        role_source: 'market_delegation_projection',
      };
      req.marketDelegationRole = {
        persisted_role: persistedRole,
        effective_role: 'market_operator',
        source: 'operator_market_scopes.projected_from_membership_id',
      };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  hasActiveProjectedMarketDelegation,
  attachMarketDelegatedRoleFor,
};
