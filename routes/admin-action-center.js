/**
 * @komerce-arch
 * @role          canonical-action-center-route
 * @domain        decision-signals
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_actor, server_route_market_code, signal_ref, action_payload
 * @outputs       canonical_action_center_projection, signal_lifecycle_action_results
 * @depends       db.js, middleware/auth.js, middleware/require-decision-signal-global-authority.js, services/action-center-workspace.js, services/market-delegation-service.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       decision_signal_global_access_grants, markets, market_operating_assignments, assignment_memberships, membership_capabilities, assignment_capability_ceiling
 * @db-write-via:signal-admin-service signals
 * @db-write-via:market-delegation-service market_delegation_audit
 * @db-txn        none
 * @doctrine      exact_market_scope_is_server_authority, signal_ref_only, global_and_market_action_centers_never_cross_scope, action_center_never_mutates_source_entities
 * @impact-areas  decision-signals, admin-dashboard, market-authorization, market-delegation
 * @version       2026-09
 */

'use strict';

const express = require('express');
const db = require('../db');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const {
  hasDecisionSignalGlobalAuthority,
  requireDecisionSignalGlobalAuthority,
} = require('../middleware/require-decision-signal-global-authority');
const workspace = require('../services/action-center-workspace');
const {
  resolveActiveAssignmentByMarketCode,
  resolveAuthorization,
  audit,
} = require('../services/market-delegation-service');

const FORBIDDEN_KEYS = new Set([
  'id', 'ids', 'signal_id', 'signalId', 'entity_id', 'entityId',
  'market_id', 'marketId', 'market_code', 'marketCode',
]);

function hasForbiddenAuthority(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasForbiddenAuthority);
  return Object.entries(value).some(([key, nested]) => FORBIDDEN_KEYS.has(key) || hasForbiddenAuthority(nested));
}

function rejectBrowserAuthority(req, res, next) {
  if (hasForbiddenAuthority(req.query) || hasForbiddenAuthority(req.body)) {
    return res.status(400).json({
      error: 'Identifiant interne ou dimension marché interdite dans le Centre d’actions Canonical',
      code: 'action_center_internal_authority_forbidden',
    });
  }
  next();
}

function sendAction(res, action, result) {
  return res.json({ ok: true, action, result });
}

function handleError(error, res, next) {
  if (error && error.status) {
    return res.status(error.status).json({ error: error.message, code: error.code || null });
  }
  return next(error);
}

async function resolveMarketAuthority(req, requiredCapability) {
  const marketCode = req.params.marketCode;
  if (req.user.role === 'admin') {
    const allowed = await hasDecisionSignalGlobalAuthority(req.user.id);
    if (!allowed) {
      const error = new Error('Accès refusé — autorité globale Centre d’actions requise');
      error.code = 'decision_signal_global_access_denied';
      error.status = 403;
      throw error;
    }
    return resolveActiveAssignmentByMarketCode(db, marketCode);
  }

  return resolveAuthorization(db, {
    userId: req.user.id,
    marketCode,
    requiredCapability,
  });
}

function publicMarket(authz) {
  return {
    id: authz.market_id,
    code: authz.market_code,
    name: authz.market_name,
    currency: authz.currency,
  };
}

async function auditMarketLifecycle(req, authz, action, result) {
  await audit(db, {
    actorUserId: req.user.id,
    assignmentId: authz.assignment_id,
    membershipId: authz.membership_id || null,
    capability: req.user.role === 'market_operator' ? 'decision_signal.manage' : null,
    action,
    before: null,
    after: { signal_ref: result.signal_ref, status: result.status },
    correlationId: req.get('x-correlation-id') || null,
  });
}

router.use(authenticate, rejectBrowserAuthority);

// Market Action Center — same decision-signals owner, exact server-resolved
// market scope. No market_id is ever accepted from the browser.
router.get(
  '/market/:marketCode',
  requireRole(['admin', 'market_operator']),
  async (req, res, next) => {
    try {
      const authz = await resolveMarketAuthority(req, 'dashboard.market.read');
      res.set('Cache-Control', 'private, no-store');
      res.json(await workspace.buildMarketWorkspace(publicMarket(authz), req.query || {}));
    } catch (error) { handleError(error, res, next); }
  }
);

router.post(
  '/market/:marketCode/signals/:signalRef/acknowledge',
  requireRole(['admin', 'market_operator']),
  async (req, res, next) => {
    try {
      const authz = await resolveMarketAuthority(req, 'decision_signal.manage');
      const result = await workspace.acknowledge(req.params.signalRef, authz.market_id);
      await auditMarketLifecycle(req, authz, 'DECISION_SIGNAL_ACKNOWLEDGED', result);
      sendAction(res, 'acknowledge_signal', result);
    } catch (error) { handleError(error, res, next); }
  }
);

router.post(
  '/market/:marketCode/signals/:signalRef/snooze',
  requireRole(['admin', 'market_operator']),
  async (req, res, next) => {
    try {
      const authz = await resolveMarketAuthority(req, 'decision_signal.manage');
      const result = await workspace.snooze(req.params.signalRef, req.body && req.body.hours, authz.market_id);
      await auditMarketLifecycle(req, authz, 'DECISION_SIGNAL_SNOOZED', result);
      sendAction(res, 'snooze_signal', result);
    } catch (error) { handleError(error, res, next); }
  }
);

router.post(
  '/market/:marketCode/signals/:signalRef/resolve',
  requireRole(['admin', 'market_operator']),
  async (req, res, next) => {
    try {
      const authz = await resolveMarketAuthority(req, 'decision_signal.manage');
      const result = await workspace.resolve(req.params.signalRef, req.user, authz.market_id);
      await auditMarketLifecycle(req, authz, 'DECISION_SIGNAL_RESOLVED', result);
      sendAction(res, 'resolve_signal', result);
    } catch (error) { handleError(error, res, next); }
  }
);

// Global Action Center remains explicitly central-only and can never see or
// mutate rows carrying a market_id because the services default to NULL scope.
router.use(requireRole(['admin']), requireDecisionSignalGlobalAuthority);

router.get('/', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await workspace.buildWorkspace(req.query || {}));
  } catch (error) { handleError(error, res, next); }
});

router.post('/generate', async (req, res, next) => {
  try { sendAction(res, 'generate_signals', await workspace.generateSignals(req.body && req.body.types)); }
  catch (error) { handleError(error, res, next); }
});

router.post('/signals/:signalRef/acknowledge', async (req, res, next) => {
  try { sendAction(res, 'acknowledge_signal', await workspace.acknowledge(req.params.signalRef)); }
  catch (error) { handleError(error, res, next); }
});

router.post('/signals/:signalRef/snooze', async (req, res, next) => {
  try { sendAction(res, 'snooze_signal', await workspace.snooze(req.params.signalRef, req.body && req.body.hours)); }
  catch (error) { handleError(error, res, next); }
});

router.post('/signals/:signalRef/resolve', async (req, res, next) => {
  try { sendAction(res, 'resolve_signal', await workspace.resolve(req.params.signalRef, req.user)); }
  catch (error) { handleError(error, res, next); }
});

module.exports = router;
module.exports._test = {
  hasForbiddenAuthority,
  rejectBrowserAuthority,
  resolveMarketAuthority,
  publicMarket,
};
