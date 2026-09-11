/**
 * @komerce-arch
 * @role          market-execution-capability-bridge
 * @domain        market-delegation
 * @layer         middleware
 * @criticality   high
 * @inputs        authenticated user, canonical marketCode, exact execution capability
 * @outputs       request-local compatibility role after exact capability proof
 * @depends       db.js, services/market-delegation-service.js
 * @used-by       routes/admin-operations-workspace.js
 * @db-read       markets, market_operating_assignments, assignment_memberships, membership_capabilities, assignment_capability_ceiling
 * @db-write      market_delegation_audit
 * @db-txn        none
 * @doctrine      execution_is_explicit_capability, audit_before_domain_mutation, users_role_never_mutated, native_terrain_roles_keep_native_boundary
 * @impact-areas  market-delegation, dashboard, operations, authorization
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const { resolveAuthorization, audit } = require('../services/market-delegation-service');

const NATIVE_OPERATIONAL_ROLES = new Set(['admin', 'agent_hub', 'agent_relais']);

function sendDelegationError(res, error) {
  if (!error || !error.code || !error.status) return false;
  res.status(error.status).json({ error: error.message, code: error.code });
  return true;
}

function correlationId(req) {
  const raw = req.headers && req.headers['x-correlation-id'];
  return raw ? String(raw).slice(0, 200) : null;
}

function safeResourceParams(params = {}) {
  return Object.fromEntries(Object.entries(params)
    .filter(([key]) => key !== 'marketCode')
    .map(([key, value]) => [key, value == null ? null : String(value).slice(0, 200)]));
}

function attachMarketExecutionRoleFor({ capability, compatibilityRole, nativeRoles = [] }) {
  if (!String(capability || '').startsWith('execution.')) {
    throw new TypeError('execution capability requise');
  }
  if (!compatibilityRole) throw new TypeError('compatibilityRole requis');
  const native = new Set(nativeRoles);

  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentification requise.', code: 'AUTH_REQUIRED' });

    // Les rôles terrain/admin historiques ne passent jamais par le fallback
    // capability. S'ils sont admis pour cette action, le requireRole aval les
    // accepte ; sinon il les refuse en 403 comme avant ce bridge. Cela évite
    // qu'un agent_hub tente d'emprunter une capability relais (ou inversement).
    if (native.has(req.user.role) || NATIVE_OPERATIONAL_ROLES.has(req.user.role)) return next();

    try {
      const authz = await resolveAuthorization(db, {
        userId: req.user.id,
        marketCode: req.params.marketCode,
        requiredCapability: capability,
      });
      if (req.workspaceMarket && String(authz.market_id) !== String(req.workspaceMarket.id)) {
        return res.status(403).json({ error: 'Marché hors périmètre.', code: 'MARKET_SCOPE_DENIED' });
      }

      await audit(db, {
        actorUserId: req.user.id,
        assignmentId: authz.assignment_id,
        membershipId: authz.membership_id,
        capability,
        action: 'EXECUTION_AUTHORIZED',
        after: {
          source: 'canonical_operations_workspace',
          market_code: authz.market_code,
          method: req.method,
          resource: safeResourceParams(req.params),
        },
        correlationId: correlationId(req),
      });

      const persistedRole = req.user.role;
      req.user = {
        ...req.user,
        persisted_role: persistedRole,
        role: compatibilityRole,
        role_source: 'market_execution_capability',
        execution_capability: capability,
      };
      req.marketExecution = {
        capability,
        assignment_id: authz.assignment_id,
        membership_id: authz.membership_id,
        market_id: authz.market_id,
        market_code: authz.market_code,
        persisted_role: persistedRole,
        compatibility_role: compatibilityRole,
      };
      return next();
    } catch (error) {
      if (sendDelegationError(res, error)) return undefined;
      return next(error);
    }
  };
}

module.exports = {
  NATIVE_OPERATIONAL_ROLES,
  attachMarketExecutionRoleFor,
  safeResourceParams,
  correlationId,
};
