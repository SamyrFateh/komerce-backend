/**
 * @komerce-arch
 * @role          canonical-sourcing-workspace-api
 * @domain        sourcing
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_session, sourcing_global_grant, business_references, action_payloads
 * @outputs       global_sourcing_projection, sourcing_action_results
 * @depends       middleware/auth.js, middleware/require-sourcing-global-authority.js, services/sourcing-workspace.js
 * @used-by       bootstrap/api-routes.js, canonical sourcing workspace
 * @db-read       none
 * @db-write      none
 * @db-txn        delegated_to_sourcing_workspace_service
 * @doctrine      global_sourcing_authority, no_client_market_dimension, no_browser_internal_ids
 * @impact-areas  sourcing, catalog, partners, admin-dashboard
 * @version       2026-08
 */

'use strict';

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { requireSourcingGlobalAuthority } = require('../middleware/require-sourcing-global-authority');
const workspace = require('../services/sourcing-workspace');

const router = express.Router();
const guard = [authenticate, requireRole(['admin', 'sourcing']), requireSourcingGlobalAuthority];
const MARKET_FIELDS = ['market_id', 'marketId', 'market_code', 'marketCode'];
const INTERNAL_ID_FIELDS = ['id', 'candidate_id', 'product_id', 'partner_id', 'import_id'];

function hasOwnAny(obj, names) {
  return Boolean(obj) && names.some(name => Object.prototype.hasOwnProperty.call(obj, name));
}

function rejectForbiddenDimensions(req, res, next) {
  if (hasOwnAny(req.query, MARKET_FIELDS) || hasOwnAny(req.body, MARKET_FIELDS)) {
    return res.status(400).json({
      error: 'Le Sourcing Canonical est global et ne reçoit aucune dimension marché client.',
      code: 'sourcing_market_dimension_forbidden',
    });
  }
  if (hasOwnAny(req.query, INTERNAL_ID_FIELDS) || hasOwnAny(req.body, INTERNAL_ID_FIELDS)) {
    return res.status(400).json({
      error: 'Les identifiants internes ne sont pas acceptés par le Sourcing Canonical.',
      code: 'sourcing_internal_id_forbidden',
    });
  }
  return next();
}

router.use(...guard, rejectForbiddenDimensions);

function sendAction(res, action, result, status = 200) {
  res.status(status).json({ ok: true, action, result });
}

function handleError(err, res, next) {
  if (err?.status) {
    return res.status(err.status).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.details ? { details: err.details } : {}),
    });
  }
  return next(err);
}

router.get('/', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await workspace.buildWorkspace());
  } catch (err) { handleError(err, res, next); }
});

router.post('/imports', async (req, res, next) => {
  try { sendAction(res, 'import_catalog', await workspace.importCatalog(req.body, req.user)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/products/:productRef/update', async (req, res, next) => {
  try { sendAction(res, 'update_sourcing_product', await workspace.updatePortfolioProduct(req.params.productRef, req.body, req.user)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/candidates/:candidateRef/update', async (req, res, next) => {
  try { sendAction(res, 'update_candidate', await workspace.updateCandidate(req.params.candidateRef, req.body, req.user)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/candidates/:candidateRef/scan', async (req, res, next) => {
  try { sendAction(res, 'scan_candidate', await workspace.scanCandidate(req.params.candidateRef, req.user)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/candidates/:candidateRef/promote', async (req, res, next) => {
  try { sendAction(res, 'promote_candidate', await workspace.promoteCandidate(req.params.candidateRef, req.body, req.user)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/candidates/:candidateRef/watchlist', async (req, res, next) => {
  try { sendAction(res, 'watchlist_candidate', await workspace.watchlistCandidate(req.params.candidateRef, req.user)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/candidates/:candidateRef/reject', async (req, res, next) => {
  try { sendAction(res, 'reject_candidate', await workspace.rejectCandidate(req.params.candidateRef, req.body?.reason || '', req.user)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/suppliers', async (req, res, next) => {
  try { sendAction(res, 'create_sourcing_supplier', await workspace.createSupplier(req.body), 201); }
  catch (err) { handleError(err, res, next); }
});

router.post('/suppliers/:partnerRef/update', async (req, res, next) => {
  try { sendAction(res, 'update_sourcing_supplier', await workspace.updateSupplier(req.params.partnerRef, req.body)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/suppliers/:partnerRef/deactivate', async (req, res, next) => {
  try { sendAction(res, 'deactivate_sourcing_supplier', await workspace.setSupplierActive(req.params.partnerRef, false)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/suppliers/:partnerRef/activate', async (req, res, next) => {
  try { sendAction(res, 'activate_sourcing_supplier', await workspace.setSupplierActive(req.params.partnerRef, true)); }
  catch (err) { handleError(err, res, next); }
});

module.exports = router;
