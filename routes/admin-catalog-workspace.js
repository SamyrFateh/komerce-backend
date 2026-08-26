/**
 * @komerce-arch
 * @role          canonical-catalog-workspace-route
 * @domain        catalog
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_central_admin, catalog_action_payload
 * @outputs       catalog_workspace_projection, catalog_mutation_result
 * @depends       middleware/auth.js, middleware/require-catalog-global-authority.js, services/catalog-workspace.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       catalog_global_access_grants
 * @db-write      none
 * @db-txn        delegated_to_catalog_domain_services
 * @doctrine      catalog_global_authority_explicit, workspace_acts_dashboard_observes, global_catalog_not_market_scoped
 * @impact-areas  admin-dashboard, catalog, authorization
 * @version       2026-08
 */

'use strict';

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { requireCatalogGlobalAuthority } = require('../middleware/require-catalog-global-authority');
const workspace = require('../services/catalog-workspace');
const taxonomy = require('../services/boutique-taxonomy-admin');
const log = require('../utils/logger').child({ module: 'admin-catalog-workspace' });

const router = express.Router();
const guard = [authenticate, requireRole(['admin']), requireCatalogGlobalAuthority];

function rejectMarketDimension(req, res, next) {
  const query = req.query || {};
  const body = req.body || {};
  const forbidden = ['market_id', 'marketId', 'market_code', 'marketCode'];
  if (forbidden.some(key => Object.prototype.hasOwnProperty.call(query, key) || Object.prototype.hasOwnProperty.call(body, key))) {
    return res.status(400).json({
      error: 'Le catalogue Canonical est global — aucun marché client n’est accepté',
      code: 'catalog_market_dimension_forbidden',
    });
  }
  next();
}

function sendError(err, res, next) {
  if (err instanceof workspace.CatalogWorkspaceError || err instanceof taxonomy.TaxonomyAdminError || err.status) {
    return res.status(err.status || 400).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
    });
  }
  return next(err);
}

router.use(...guard, rejectMarketDimension);

router.get('/', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    res.json(await workspace.buildWorkspace(req.query));
  } catch (err) { next(err); }
});

router.post('/products', async (req, res, next) => {
  try {
    res.status(201).json({ ok: true, action: 'product_created', result: await workspace.createProduct(req.body, req.user) });
  } catch (err) { sendError(err, res, next); }
});

router.post('/products/:productRef/update', async (req, res, next) => {
  try {
    res.json({ ok: true, action: 'product_updated', result: await workspace.updateProduct(req.params.productRef, req.body, req.user) });
  } catch (err) { sendError(err, res, next); }
});

router.post('/products/:productRef/deactivate', async (req, res, next) => {
  try {
    res.json({ ok: true, action: 'product_deactivated', result: await workspace.deactivateProduct(req.params.productRef) });
  } catch (err) { sendError(err, res, next); }
});

router.post('/approval/:productRef/approve', async (req, res, next) => {
  try {
    res.json({ ok: true, action: 'catalog_candidate_approved', result: await workspace.approveCandidate(req.params.productRef, req.user) });
  } catch (err) { sendError(err, res, next); }
});

router.post('/approval/:productRef/reject', async (req, res, next) => {
  try {
    res.json({ ok: true, action: 'catalog_candidate_rejected', result: await workspace.rejectCandidate(req.params.productRef, req.body && req.body.reason, req.user) });
  } catch (err) { sendError(err, res, next); }
});

router.post('/approval/:productRef/override', async (req, res, next) => {
  try {
    res.json({ ok: true, action: 'catalog_candidate_overridden', result: await workspace.overrideCandidate(req.params.productRef, req.body, req.user) });
  } catch (err) { sendError(err, res, next); }
});

router.post('/categories', async (req, res, next) => {
  try {
    res.status(201).json({ ok: true, action: 'category_created', result: await workspace.createCategory(req.body) });
  } catch (err) { sendError(err, res, next); }
});

router.post('/categories/:key/update', async (req, res, next) => {
  try {
    res.json({ ok: true, action: 'category_updated', result: await workspace.updateCategory(req.params.key, req.body) });
  } catch (err) { sendError(err, res, next); }
});

router.post('/categories/:key/deactivate', async (req, res, next) => {
  try {
    res.json({ ok: true, action: 'category_deactivated', result: await workspace.deactivateCategory(req.params.key) });
  } catch (err) { sendError(err, res, next); }
});

router.post('/categories/:key/subcategories', async (req, res, next) => {
  try {
    res.status(201).json({ ok: true, action: 'subcategory_created', result: await workspace.createSubcategory(req.params.key, req.body) });
  } catch (err) { sendError(err, res, next); }
});

router.post('/categories/:key/subcategories/:subKey/update', async (req, res, next) => {
  try {
    res.json({ ok: true, action: 'subcategory_updated', result: await workspace.updateSubcategory(req.params.key, req.params.subKey, req.body) });
  } catch (err) { sendError(err, res, next); }
});

router.post('/categories/:key/subcategories/:subKey/deactivate', async (req, res, next) => {
  try {
    res.json({ ok: true, action: 'subcategory_deactivated', result: await workspace.deactivateSubcategory(req.params.key, req.params.subKey) });
  } catch (err) { sendError(err, res, next); }
});

router.use((err, req, res, next) => {
  log.error({ err }, '[catalog-workspace] unhandled error');
  next(err);
});

module.exports = router;
module.exports._test = { rejectMarketDimension, sendError };
