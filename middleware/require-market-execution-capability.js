/**
 * @komerce-arch
 * @role          market-delegation-execution-capability-guard
 * @domain        market-delegation
 * @layer         middleware
 * @criticality   high
 * @inputs        authenticated user, server-resolved workspace market, execution capability
 * @outputs       authorized field execution attempt + delegation audit
 * @depends       db.js, services/capability-registry.js, services/market-delegation-service.js
 * @used-by       routes/admin-operations-workspace.js
 * @db-read       markets, market_operating_assignments, assignment_memberships, membership_capabilities, assignment_capability_ceiling
 * @db-write      market_delegation_audit
 * @db-txn        none (audit-before-domain-mutation)
 * @doctrine      execution_is_explicit_capability, manager_is_not_implicit_field_agent, server_market_is_authority
 * @impact-areas  market-delegation, operations, payments, authorization
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const { byName } = require('../services/capability-registry');
const { resolveAuthorization, audit } = require('../services/market-delegation-service');

function correlationId(req) {
  const raw = req && req.headers && req.headers['x-correlation-id'];
  return raw ? String(raw).slice(0, 200) : null;
}

function validateExecutionCapability(capability) {
  const row = byName(capability);
  if (!row || row.class !== 'EXECUTION' || row.authority_scope !== 'MARKET' ||
      row.delegation_mode !== 'DELEGABLE' || row.status !== 'LIVE') {
    const error = new Error(`Capability terrain invalide ou non LIVE: ${capability}`);
    error.code = 'MARKET_EXECUTION_CAPABILITY_INVALID';
    error.status = 500;
    throw error;
  }
  return row;
}

function sendKnownError(res, error) {
  if (!error || !error.code || !Number.isInteger(error.status)) return false;
  res.status(error.status).json({ error: error.message, code: error.code });
  return true;
}

/**
 * Autorise une action terrain exclusivement par membership + capability.
 *
 * L'audit est volontairement écrit AVANT d'appeler le lifecycle owner. Il
 * atteste une tentative autorisée, pas un succès métier. Ainsi un échec de
 * l'audit empêche toute mutation terrain, sans exiger une transaction qui
 * traverserait artificiellement plusieurs domaines/lifecycle owners.
 */
function requireMarketExecutionCapability(requiredCapability) {
  validateExecutionCapability(requiredCapability);

  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'Authentification requise.', code: 'AUTH_REQUIRED' });
      }
      const market = req.workspaceMarket;
      if (!market || !market.code || !market.id) {
        return res.status(500).json({
          error: 'Marché serveur non résolu avant autorisation terrain.',
          code: 'WORKSPACE_MARKET_NOT_RESOLVED',
        });
      }

      const authz = await resolveAuthorization(db, {
        userId: req.user.id,
        marketCode: market.code,
        requiredCapability,
      });
      if (authz.market_id !== market.id) {
        return res.status(403).json({
          error: 'La membership ne correspond pas au marché résolu.',
          code: 'MARKET_EXECUTION_SCOPE_MISMATCH',
        });
      }

      await audit(db, {
        actorUserId: req.user.id,
        assignmentId: authz.assignment_id,
        membershipId: authz.membership_id,
        capability: requiredCapability,
        action: 'EXECUTION_AUTHORIZED_ATTEMPT',
        after: {
          market_code: market.code,
          method: req.method,
          path: String(req.originalUrl || req.url || '').split('?')[0],
        },
        correlationId: correlationId(req),
      });

      req.marketExecutionAuthorization = Object.freeze({
        assignment_id: authz.assignment_id,
        membership_id: authz.membership_id,
        capability: requiredCapability,
        market_id: authz.market_id,
        market_code: authz.market_code,
      });
      return next();
    } catch (error) {
      if (sendKnownError(res, error)) return;
      return next(error);
    }
  };
}

module.exports = {
  correlationId,
  validateExecutionCapability,
  requireMarketExecutionCapability,
};
