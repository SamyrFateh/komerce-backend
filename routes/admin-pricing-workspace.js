/**
 * @komerce-arch
 * @role          canonical-pricing-workspace-route
 * @domain        economic-engine
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_pricing_operator, resolved_market_code, business_refs, pricing_payload
 * @outputs       canonical_pricing_projection, market_cost_projection, action_results
 * @depends       db.js, middleware/auth.js, middleware/require-pricing-global-authority.js, middleware/require-market-scope.js, services/pricing-workspace.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       markets, operator_market_scopes, pricing_global_access_grants
 * @db-write      none
 * @db-txn        none
 * @doctrine      global_pricing_authority_or_server_market_scope, viewer_reads_manager_writes, browser_business_refs_only
 * @impact-areas  pricing, economic-engine, admin-dashboard, market-authorization
 * @version       2026-09
 */

'use strict';

const express = require('express');
const db = require('../db');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { attachAuthorizedMarkets, requireMarketScope, requireMarketScopeRole } = require('../middleware/require-market-scope');
const { hasPricingGlobalAuthority, requirePricingGlobalAuthority } = require('../middleware/require-pricing-global-authority');
const workspace = require('../services/pricing-workspace');

const MARKET_CODE = /^[A-Z]{2}$/;
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

async function resolveRequestedMarket(req, res, next) {
  const code = String(req.params.marketCode || '').trim().toUpperCase();
  if (!MARKET_CODE.test(code)) {
    return res.status(400).json({ error: 'Code marché invalide', code: 'invalid_market_code' });
  }
  try {
    const { rows } = await db.query(
      `SELECT id, code, name, currency
         FROM markets
        WHERE code = $1 AND is_active = TRUE
        LIMIT 1`,
      [code]
    );
    if (!rows.length) return res.status(404).json({ error: 'Marché introuvable ou inactif', code: 'market_not_found' });
    req.workspaceMarket = rows[0];
    return next();
  } catch (error) { return next(error); }
}

function runLocalMarketGuard(req, res, next) {
  const targetMarketId = req.workspaceMarket && req.workspaceMarket.id;
  return requireMarketScope(() => targetMarketId)(req, res, next);
}

async function requireMarketPricingAccess(req, res, next) {
  const targetMarketId = req.workspaceMarket && req.workspaceMarket.id;

  // L'autorité centrale reste prioritaire pour les administrateurs : un admin
  // global peut intervenir sur un override pays même s'il possède par ailleurs
  // un grant local viewer. Les partenaires market_operator n'empruntent jamais
  // cette branche.
  if (req.user && req.user.role === 'admin') {
    try {
      if (await hasPricingGlobalAuthority(req.user.id)) {
        req.pricingGlobalAuthority = true;
        return next();
      }
    } catch (error) { return next(error); }
  }

  if (req.authorizedMarketScopes && req.authorizedMarketScopes.has(targetMarketId)) {
    req.marketScopeRole = req.authorizedMarketScopes.get(targetMarketId);
  }
  return runLocalMarketGuard(req, res, next);
}

function requireMarketPricingManager(req, res, next) {
  if (req.pricingGlobalAuthority) return next();
  const targetMarketId = req.workspaceMarket && req.workspaceMarket.id;
  return requireMarketScopeRole(() => targetMarketId, ['manager'])(req, res, next);
}

function sendAction(res, action, result, status = 200) {
  return res.status(status).json({ ok: true, action, result });
}

function handleError(error, res, next) {
  if (error && error.status) {
    return res.status(error.status).json({ error: error.message, code: error.code || null });
  }
  return next(error);
}

router.use(
  '/market/:marketCode',
  authenticate,
  requireRole(['admin', 'market_operator']),
  rejectBrowserAuthority,
  resolveRequestedMarket,
  attachAuthorizedMarkets,
  requireMarketPricingAccess
);

// viewer + manager : lecture du modèle effectif du marché.
router.get('/market/:marketCode', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    res.json(await workspace.buildMarketWorkspace({ market: req.workspaceMarket }));
  } catch (error) { handleError(error, res, next); }
});

// manager uniquement (ou autorité Pricing globale centrale) : mutations pays.
router.post('/market/:marketCode/cost-components/:key/update', requireMarketPricingManager, async (req, res, next) => {
  try {
    sendAction(res, 'update_market_cost_component', await workspace.updateMarketCostComponent(
      req.workspaceMarket,
      req.params.key,
      req.body || {},
      req.user
    ));
  } catch (error) { handleError(error, res, next); }
});

router.post('/market/:marketCode/cost-components/:key/toggle', requireMarketPricingManager, async (req, res, next) => {
  try {
    sendAction(res, 'toggle_market_cost_component', await workspace.toggleMarketCostComponent(
      req.workspaceMarket,
      req.params.key,
      req.user
    ));
  } catch (error) { handleError(error, res, next); }
});

router.post('/market/:marketCode/cost-components/:key/reset', requireMarketPricingManager, async (req, res, next) => {
  try {
    sendAction(res, 'reset_market_cost_component', await workspace.resetMarketCostComponent(
      req.workspaceMarket,
      req.params.key,
      req.user
    ));
  } catch (error) { handleError(error, res, next); }
});

// Global Pricing remains a distinct central authority. A market_operator can
// never fall through to these routes because the role guard is admin-only.
router.use(authenticate, requireRole(['admin']), requirePricingGlobalAuthority, rejectBrowserAuthority);

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
