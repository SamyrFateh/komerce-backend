/**
 * @komerce-arch
 * @role          canonical-pricing-workspace-route
 * @domain        economic-engine
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_admin, pricing_global_grant, business_refs, pricing_payload
 * @outputs       canonical_pricing_projection, action_results
 * @depends       middleware/auth.js, middleware/require-pricing-global-authority.js, services/pricing-workspace.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      global_pricing_authority, browser_business_refs_only, no_market_authority
 * @impact-areas  pricing, economic-engine, admin-dashboard
 * @version       2026-08
 */

'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { requirePricingGlobalAuthority } = require('../middleware/require-pricing-global-authority');
const workspace = require('../services/pricing-workspace');

const FORBIDDEN_KEYS = new Set([
  'market_id', 'marketId', 'market_code', 'marketCode',
  'product_id', 'productId', 'competitor_id', 'competitorId',
  'component_id', 'componentId',
]);

function hasForbiddenAuthority(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasForbiddenAuthority);
  return Object.entries(value).some(([key, nested]) => FORBIDDEN_KEYS.has(key) || hasForbiddenAuthority(nested));
}

function rejectBrowserAuthority(req, res, next) {
  if (hasForbiddenAuthority(req.query) || hasForbiddenAuthority(req.body)) {
    return res.status(400).json({
      error: 'Identifiant interne ou dimension marché interdite dans Pricing Canonical',
      code: 'pricing_internal_authority_forbidden',
    });
  }
  next();
}

router.use(authenticate, requireRole(['admin']), requirePricingGlobalAuthority, rejectBrowserAuthority);

function sendAction(res, action, result, status = 200) {
  return res.status(status).json({ ok: true, action, result });
}

function handleError(error, res, next) {
  if (error && error.status) {
    return res.status(error.status).json({
      error: error.message,
      code: error.code || null,
    });
  }
  return next(error);
}

router.get('/', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await workspace.buildWorkspace());
  } catch (error) { handleError(error, res, next); }
});

router.post('/simulate', async (req, res, next) => {
  try { sendAction(res, 'simulate', await workspace.simulate(req.body || {})); }
  catch (error) { handleError(error, res, next); }
});

router.post('/flow', async (req, res, next) => {
  try { sendAction(res, 'flow', await workspace.flow(req.body || {})); }
  catch (error) { handleError(error, res, next); }
});

router.post('/products/:productRef/apply-price', async (req, res, next) => {
  try { sendAction(res, 'apply_price', await workspace.applyPrice(req.params.productRef, req.body || {}, req.user)); }
  catch (error) { handleError(error, res, next); }
});

router.get('/strategy', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await workspace.getStrategy({ product_ref: req.query.product_ref, category: req.query.category }));
  } catch (error) { handleError(error, res, next); }
});

router.post('/strategy/apply', async (req, res, next) => {
  try { sendAction(res, 'apply_strategy', await workspace.applyStrategy(req.body || {}, req.user)); }
  catch (error) { handleError(error, res, next); }
});

router.post('/competitors', async (req, res, next) => {
  try { sendAction(res, 'create_competitor', await workspace.addCompetitor(req.body || {}), 201); }
  catch (error) { handleError(error, res, next); }
});

router.post('/competitors/:competitorRef/deactivate', async (req, res, next) => {
  try { sendAction(res, 'deactivate_competitor', await workspace.deactivateCompetitor(req.params.competitorRef)); }
  catch (error) { handleError(error, res, next); }
});

router.post('/cost-components', async (req, res, next) => {
  try { sendAction(res, 'create_cost_component', await workspace.createCostComponent(req.body || {}, req.user), 201); }
  catch (error) { handleError(error, res, next); }
});

router.post('/cost-components/:key/update', async (req, res, next) => {
  try { sendAction(res, 'update_cost_component', await workspace.updateCostComponent(req.params.key, req.body || {}, req.user)); }
  catch (error) { handleError(error, res, next); }
});

router.post('/cost-components/:key/toggle', async (req, res, next) => {
  try { sendAction(res, 'toggle_cost_component', await workspace.toggleCostComponent(req.params.key, req.user)); }
  catch (error) { handleError(error, res, next); }
});

module.exports = router;
