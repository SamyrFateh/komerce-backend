/**
 * @komerce-arch
 * @role          canonical-action-center-route
 * @domain        decision-signals
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_admin, decision_signal_global_grant, signal_ref, action_payload
 * @outputs       canonical_action_center_projection, signal_lifecycle_action_results
 * @depends       middleware/auth.js, middleware/require-decision-signal-global-authority.js, services/action-center-workspace.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      global_action_center_authority, signal_ref_only, no_market_authority, action_center_never_mutates_source_entities
 * @impact-areas  decision-signals, admin-dashboard
 * @version       2026-08
 */

'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { requireDecisionSignalGlobalAuthority } = require('../middleware/require-decision-signal-global-authority');
const workspace = require('../services/action-center-workspace');

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

router.use(authenticate, requireRole(['admin']), requireDecisionSignalGlobalAuthority, rejectBrowserAuthority);

function sendAction(res, action, result) {
  return res.json({ ok: true, action, result });
}

function handleError(error, res, next) {
  if (error && error.status) {
    return res.status(error.status).json({ error: error.message, code: error.code || null });
  }
  return next(error);
}

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
