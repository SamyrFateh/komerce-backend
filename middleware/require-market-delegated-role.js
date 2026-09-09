/**
 * @komerce-arch
 * @role          market-delegation-runtime-role-bridge
 * @domain        market-delegation
 * @layer         middleware
 * @criticality   high
 * @inputs        authenticated user, requested allowed roles, active projected memberships
 * @outputs       effective request-local market_operator role or original role decision
 * @depends       db.js, middleware/auth.js
 * @used-by       routes that already admit market_operator
 * @db-read       operator_market_scopes, assignment_memberships, market_operating_assignments
 * @db-write      none
 * @db-txn        none
 * @doctrine      users_role_is_not_market_authority, delegated_role_is_request_local_projection
 * @impact-areas  market-delegation, authorization, admin-dashboard
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const { requireRole } = require('./auth');

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
 * Compatibility wrapper for routes that already list `market_operator` among
 * their accepted coarse roles. Persisted roles that are already accepted keep
 * their exact behavior. Only a role that would otherwise be rejected may be
 * projected request-locally to market_operator, and only when the active
 * membership projection is proven server-side.
 *
 * No users.role mutation occurs. Downstream legacy market guards see the
 * request-local market_operator value and therefore continue to apply their
 * existing operator_market_scopes filtering.
 */
function requireRoleWithMarketDelegation(roles) {
  const allowed = Array.isArray(roles) ? [...roles] : [];
  const baseGuard = requireRole(allowed);

  return async (req, res, next) => {
    if (!req.user) return baseGuard(req, res, next);
    if (allowed.includes(req.user.role)) return next();
    if (!allowed.includes('market_operator')) return baseGuard(req, res, next);

    try {
      const delegated = await hasActiveProjectedMarketDelegation(req.user.id);
      if (!delegated) return baseGuard(req, res, next);

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
  requireRoleWithMarketDelegation,
};
