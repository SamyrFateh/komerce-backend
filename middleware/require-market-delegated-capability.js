/**
 * @komerce-arch
 * @role          market-delegated-capability-bridge
 * @domain        market-delegation
 * @layer         middleware
 * @criticality   high
 * @inputs        authenticated user, canonical marketCode, exact DELEGATION capability
 * @outputs       403 on missing/outside-ceiling capability, request-local authz proof otherwise
 * @depends       db.js, services/market-delegation-service.js
 * @used-by       routes/admin-pricing-workspace.js, routes/transitaire-api.js, routes/hub.js, routes/hub-dashboard.js
 * @db-read       markets, market_operating_assignments, assignment_memberships, membership_capabilities, assignment_capability_ceiling
 * @db-write      market_delegation_audit
 * @db-txn        none
 * @doctrine      capability_is_the_authority_not_role, audit_before_domain_mutation, users_role_never_mutated, market_scope_is_server_resolved
 * @impact-areas  market-delegation, pricing, authorization
 * @version       2026-10-d4
 */
'use strict';

const db = require('../db');
const { resolveAuthorization, resolveSingleMarketAuthorization, listAuthorizedMarketsForCapability, audit } = require('../services/market-delegation-service');

function sendDelegationError(res, error) {
  if (!error || !error.code || !error.status) return false;
  res.status(error.status).json({ error: error.message, code: error.code });
  return true;
}

function correlationId(req) {
  const raw = req.headers && req.headers['x-correlation-id'];
  return raw ? String(raw).slice(0, 200) : null;
}

/**
 * Gate a route on an exact DELEGATION capability instead of `req.user.role`.
 *
 * Unlike `attachMarketExecutionRoleFor` (EXECUTION bridge, projects a
 * compatibility role for legacy `requireRole` guards downstream), this
 * middleware IS the guard: it either calls `next()` because the capability is
 * proven, or answers 403. It never mutates `req.user.role`. Callers that
 * still need a central/global bypass (e.g. pricing global authority) must
 * check that before this middleware runs — it does not know about roles.
 */
function attachAuthorizedMarketsForCapability(capability, options = {}) {
  if (!capability || typeof capability !== 'string') {
    throw new TypeError('capability requise');
  }
  const shouldAudit = options.audit === true;

  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentification requise.', code: 'AUTH_REQUIRED' });

    try {
      const rows = await listAuthorizedMarketsForCapability(db, {
        userId: req.user.id,
        requiredCapability: capability,
      });
      if (!rows.length) {
        return res.status(403).json({
          error: `Capability ${capability} requise sur au moins un marché actif.`,
          code: 'MARKET_CAPABILITY_REQUIRED',
        });
      }

      req.authorizedMarkets = new Set(rows.map(row => row.market_id));
      req.marketDelegatedMarkets = rows;

      if (shouldAudit) {
        for (const authz of rows) {
          await audit(db, {
            actorUserId: req.user.id,
            assignmentId: authz.assignment_id,
            membershipId: authz.membership_id,
            capability,
            action: 'DELEGATION_CAPABILITY_AUTHORIZED',
            after: {
              source: req.baseUrl || 'authorized_markets_for_capability',
              market_code: authz.market_code,
              method: req.method,
              path: req.path,
            },
            correlationId: correlationId(req),
          });
        }
      }

      return next();
    } catch (error) {
      if (sendDelegationError(res, error)) return undefined;
      return next(error);
    }
  };
}

function requireSingleMarketDelegatedCapability(capability, options = {}) {
  if (!capability || typeof capability !== 'string') {
    throw new TypeError('capability requise');
  }
  const shouldAudit = options.audit !== false;

  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentification requise.', code: 'AUTH_REQUIRED' });

    try {
      const authz = await resolveSingleMarketAuthorization(db, {
        userId: req.user.id,
        requiredCapability: capability,
      });

      if (shouldAudit) {
        await audit(db, {
          actorUserId: req.user.id,
          assignmentId: authz.assignment_id,
          membershipId: authz.membership_id,
          capability,
          action: 'DELEGATION_CAPABILITY_AUTHORIZED',
          after: {
            source: req.baseUrl || 'single_market_delegated_capability',
            market_code: authz.market_code,
            method: req.method,
            path: req.path,
          },
          correlationId: correlationId(req),
        });
      }

      req.marketDelegatedCapability = {
        capability,
        assignment_id: authz.assignment_id,
        membership_id: authz.membership_id,
        market_id: authz.market_id,
        market_code: authz.market_code,
        capabilities: Array.isArray(authz.capabilities) ? authz.capabilities : [],
      };
      return next();
    } catch (error) {
      if (sendDelegationError(res, error)) return undefined;
      return next(error);
    }
  };
}

function requireMarketDelegatedCapability(capability, options = {}) {
  if (!capability || typeof capability !== 'string') {
    throw new TypeError('capability requise');
  }
  // registry: requires_audit === false pour les capabilities *.read /
  // *.simulate (cf. config/market-delegation-capabilities.js) — l'audit
  // market_delegation_audit reste la valeur par défaut pour tout le reste
  // (mutations), { audit: false } est un opt-out explicite par appelant,
  // jamais un défaut implicite.
  const shouldAudit = options.audit !== false;

  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentification requise.', code: 'AUTH_REQUIRED' });

    try {
      const authz = await resolveAuthorization(db, {
        userId: req.user.id,
        marketCode: req.params.marketCode,
        requiredCapability: capability,
      });

      if (req.workspaceMarket && String(authz.market_id) !== String(req.workspaceMarket.id)) {
        return res.status(403).json({ error: 'Marché hors périmètre.', code: 'MARKET_SCOPE_DENIED' });
      }

      if (shouldAudit) {
        await audit(db, {
          actorUserId: req.user.id,
          assignmentId: authz.assignment_id,
          membershipId: authz.membership_id,
          capability,
          action: 'DELEGATION_CAPABILITY_AUTHORIZED',
          after: {
            source: req.baseUrl || 'market_delegated_capability',
            market_code: authz.market_code,
            method: req.method,
            path: req.path,
          },
          correlationId: correlationId(req),
        });
      }

      req.marketDelegatedCapability = {
        capability,
        assignment_id: authz.assignment_id,
        membership_id: authz.membership_id,
        market_id: authz.market_id,
        market_code: authz.market_code,
        capabilities: Array.isArray(authz.capabilities) ? authz.capabilities : [],
      };
      return next();
    } catch (error) {
      if (sendDelegationError(res, error)) return undefined;
      return next(error);
    }
  };
}

module.exports = {
  attachAuthorizedMarketsForCapability,
  requireMarketDelegatedCapability,
  requireSingleMarketDelegatedCapability,
};
