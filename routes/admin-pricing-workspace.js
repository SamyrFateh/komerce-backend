/**
 * @komerce-arch
 * @role          canonical-pricing-workspace-route
 * @domain        economic-engine
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_pricing_operator, resolved_market_code, business_refs, pricing_payload, governed_market_decision_policy, structure_cost_event
 * @outputs       canonical_pricing_projection, market_cost_projection, market_decision_projection, market_price_decisions, market_corridor_projection, activation_preview, action_results, structure_cost_event_fact, structure_cost_event_history
 * @depends       db.js, middleware/auth.js, middleware/require-market-delegated-role.js, middleware/require-pricing-global-authority.js, middleware/require-market-scope.js, services/pricing-workspace.js, services/pricing-market-decision-policy.js, services/pricing-market-decision-projection.js, services/pricing-market-corridor.js, services/market-commercial-price-service.js, services/market-local-price-activation-service.js, services/pricing-period-structure.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       markets, operator_market_scopes, pricing_global_access_grants, charges, economic_structure_cost_events, users
 * @db-write      none
 * @db-txn        none
 * @doctrine      global_pricing_authority_or_server_market_scope, viewer_reads_manager_writes, country_manager_owns_local_strategy, browser_business_refs_only, simulation_is_read_only, market_decision_policy_is_append_only, one_contribution_many_views, market_corridor_is_observation_not_gate, pricing_market_viability_period_structure_truth
 * @impact-areas  pricing, economic-engine, admin-dashboard, market-authorization
 * @version       2026-09
 */

'use strict';

const express = require('express');
const db = require('../db');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoleWithMarketDelegation } = require('../middleware/require-market-delegated-role');
const {
  attachAuthorizedMarkets,
  requireMarketScope,
  requireMarketScopeRole,
  resolveMarketScopeRole,
} = require('../middleware/require-market-scope');
const { hasPricingGlobalAuthority, requirePricingGlobalAuthority } = require('../middleware/require-pricing-global-authority');
const workspace = require('../services/pricing-workspace');
const marketDecisionPolicy = require('../services/pricing-market-decision-policy');
const marketDecisionProjection = require('../services/pricing-market-decision-projection');
const pricingMarketCorridor = require('../services/pricing-market-corridor');
const marketCommercialPrice = require('../services/market-commercial-price-service');
const marketLocalPriceActivation = require('../services/market-local-price-activation-service');
const pricingPeriodStructure = require('../services/pricing-period-structure');
const { decorateMarketDecision } = marketDecisionProjection;

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

async function requireMarketPricingAccess(req, res, next) {
  const targetMarketId = req.workspaceMarket && req.workspaceMarket.id;

  // L'autorité Pricing centrale d'un admin reste prioritaire sur un éventuel
  // grant local. Un market_operator n'emprunte jamais cette branche.
  if (req.user && req.user.role === 'admin') {
    try {
      if (await hasPricingGlobalAuthority(req.user.id)) {
        req.pricingGlobalAuthority = true;
        return next();
      }
    } catch (error) { return next(error); }
  }

  return requireMarketScope(() => targetMarketId)(req, res, next);
}

async function marketAccessProjection(req) {
  if (req.pricingGlobalAuthority) {
    return {
      role: 'global_admin',
      read_only: false,
      can_manage_costs: true,
      can_manage_decision_policy: true,
      can_draft_local_prices: false,
      can_activate_local_prices: false,
      can_manage_market_observations: false,
      local_strategy_owner: false,
    };
  }

  const targetMarketId = req.workspaceMarket && req.workspaceMarket.id;
  const scopeRole = req.user && req.user.role === 'market_operator'
    ? await resolveMarketScopeRole(req.user.id, targetMarketId)
    : null;
  const canManage = scopeRole === 'manager';

  return {
    role: scopeRole || 'viewer',
    read_only: !canManage,
    can_manage_costs: canManage,
    can_manage_decision_policy: canManage,
    can_draft_local_prices: canManage,
    can_activate_local_prices: canManage,
    can_manage_market_observations: canManage,
    local_strategy_owner: canManage,
  };
}

function requireMarketPricingManager(req, res, next) {
  if (req.pricingGlobalAuthority) return next();
  if (!req.user || req.user.role !== 'market_operator') {
    return res.status(403).json({
      error: 'Accès refusé — manager marché requis',
      code: 'pricing_market_manager_required',
    });
  }
  const targetMarketId = req.workspaceMarket && req.workspaceMarket.id;
  return requireMarketScopeRole('manager')(() => targetMarketId)(req, res, next);
}

function requireCountryStrategyManager(req, res, next) {
  if (!req.user || req.user.role !== 'market_operator') {
    return res.status(403).json({
      error: 'La stratégie commerciale locale appartient au responsable du marché.',
      code: 'market_local_strategy_manager_required',
    });
  }
  const targetMarketId = req.workspaceMarket && req.workspaceMarket.id;
  return requireMarketScopeRole('manager')(() => targetMarketId)(req, res, next);
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

function handleDecisionPolicyError(error, res, next) {
  if (error && error.code === '23505') {
    return res.status(409).json({
      error: 'Version ou date d’effet déjà utilisée pour ce marché',
      code: 'pricing_market_decision_policy_conflict',
    });
  }
  const message = String(error && error.message || '');
  if (message === 'market not found or inactive') {
    return res.status(404).json({ error: 'Marché introuvable ou inactif', code: 'market_not_found' });
  }
  if (message.startsWith('policy.') || message === 'policy actor is required') {
    return res.status(400).json({ error: message, code: 'pricing_market_decision_policy_invalid' });
  }
  return handleError(error, res, next);
}

router.use(
  '/market/:marketCode',
  authenticate,
  requireRoleWithMarketDelegation(['admin', 'market_operator']),
  rejectBrowserAuthority,
  resolveRequestedMarket,
  attachAuthorizedMarkets,
  requireMarketPricingAccess
);

router.get('/market/:marketCode', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    const projection = await workspace.buildMarketWorkspace({ market: req.workspaceMarket });
    const access = await marketAccessProjection(req);
    res.json({
      ...projection,
      access,
      capabilities: {
        ...(projection.capabilities || {}),
        simulation: true,
        cost_overrides: access.can_manage_costs,
        reset_to_global: access.can_manage_costs,
        market_decision: true,
        market_corridor: true,
        manage_market_price_observations: access.can_manage_market_observations,
        manage_decision_policy: access.can_manage_decision_policy,
        local_price_drafts: access.can_draft_local_prices,
        local_price_activation: access.can_activate_local_prices,
        local_price_activation_preview: true,
        local_strategy_owner: access.local_strategy_owner,
        local_price_buyer_activation: true,
      },
    });
  } catch (error) { handleError(error, res, next); }
});

// Surface de décision : aucune date n'est fournie par le navigateur. La fenêtre
// est dérivée côté serveur depuis la politique courante du marché.
router.get('/market/:marketCode/decision', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    const rawPeriod = typeof req.query.period === 'string' ? req.query.period.trim() : '';
    if (rawPeriod && !marketDecisionPolicy.isValidCalendarMonth(rawPeriod)) {
      return res.status(400).json({ error: 'period must match YYYY-MM', code: 'pricing_market_decision_period_invalid' });
    }
    const decision = rawPeriod
      ? await marketDecisionPolicy.evaluateMarketDecision(req.workspaceMarket.id, { period: rawPeriod })
      : await marketDecisionPolicy.evaluateMarketDecision(req.workspaceMarket.id);
    res.json(decorateMarketDecision(decision));
  } catch (error) { handleError(error, res, next); }
});

router.get('/market/:marketCode/decision-policy/history', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    res.json({
      market_code: req.workspaceMarket.code,
      policies: await marketDecisionPolicy.listMarketDecisionPolicyHistory(req.workspaceMarket.id),
    });
  } catch (error) { handleError(error, res, next); }
});

router.post('/market/:marketCode/decision-policy', requireMarketPricingManager, async (req, res, next) => {
  try {
    sendAction(
      res,
      'record_market_decision_policy',
      await marketDecisionPolicy.recordMarketDecisionPolicy(
        req.workspaceMarket.id,
        req.body || {},
        req.user && req.user.id
      ),
      201
    );
  } catch (error) { handleDecisionPolicyError(error, res, next); }
});

// La simulation n'écrit rien : viewer et manager peuvent explorer un scénario
// tant qu'ils possèdent l'accès serveur au marché.
router.post('/market/:marketCode/simulate-impact', async (req, res, next) => {
  try { sendAction(res, 'simulate_impact', await workspace.simulateImpact(req.body || {}, req.workspaceMarket)); }
  catch (error) { handleError(error, res, next); }
});

router.get('/market/:marketCode/commercial-prices', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    res.json(await marketCommercialPrice.listMarketPriceDrafts(req.workspaceMarket));
  } catch (error) { handleError(error, res, next); }
});

// Corridor de prix observé : la vérité locale est distincte de la référence
// concurrence globale. Aucun fallback global n'est promu silencieusement.
router.get('/market/:marketCode/corridor', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    res.json(await pricingMarketCorridor.buildMarketCorridor({
      market: req.workspaceMarket,
      productRef: req.query.product_ref,
    }));
  } catch (error) { handleError(error, res, next); }
});

router.post('/market/:marketCode/price-observations', requireCountryStrategyManager, async (req, res, next) => {
  try {
    sendAction(res, 'record_market_price_observation', await pricingMarketCorridor.recordMarketObservation({
      market: req.workspaceMarket,
      productRef: req.body && req.body.product_ref,
      body: req.body || {},
      actorId: req.user.id,
    }), 201);
  } catch (error) { handleError(error, res, next); }
});

router.post('/market/:marketCode/price-observations/:observationRef/deactivate', requireCountryStrategyManager, async (req, res, next) => {
  try {
    sendAction(res, 'deactivate_market_price_observation', await pricingMarketCorridor.deactivateMarketObservation({
      market: req.workspaceMarket,
      observationRef: req.params.observationRef,
      actorId: req.user.id,
      reason: req.body && req.body.reason,
    }));
  } catch (error) { handleError(error, res, next); }
});

router.get('/market/:marketCode/products/:productRef/local-price/activation-preview', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    res.json(await marketLocalPriceActivation.previewLocalPriceActivation({
      market: req.workspaceMarket,
      productRef: req.params.productRef,
    }));
  } catch (error) { handleError(error, res, next); }
});

router.post('/market/:marketCode/products/:productRef/local-price', requireCountryStrategyManager, async (req, res, next) => {
  try {
    sendAction(res, 'set_market_local_price_draft', await marketCommercialPrice.setMarketPriceDraft({
      market: req.workspaceMarket,
      productRef: req.params.productRef,
      amount: req.body && req.body.amount,
      reason: req.body && req.body.reason,
      source: req.body && req.body.source,
      actorId: req.user.id,
    }));
  } catch (error) { handleError(error, res, next); }
});

router.post('/market/:marketCode/products/:productRef/local-price/activate', requireCountryStrategyManager, async (req, res, next) => {
  try {
    sendAction(res, 'activate_market_local_price', await marketLocalPriceActivation.activateLocalPrice({
      market: req.workspaceMarket,
      productRef: req.params.productRef,
      actorId: req.user.id,
      reason: req.body && req.body.reason,
      source: req.body && req.body.source,
    }));
  } catch (error) { handleError(error, res, next); }
});

router.post('/market/:marketCode/products/:productRef/local-price/reset', requireCountryStrategyManager, async (req, res, next) => {
  try {
    sendAction(res, 'reset_market_local_price_draft', await marketCommercialPrice.resetMarketPriceDraft({
      market: req.workspaceMarket,
      productRef: req.params.productRef,
      reason: req.body && req.body.reason,
      source: req.body && req.body.source,
      actorId: req.user.id,
    }));
  } catch (error) { handleError(error, res, next); }
});

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

// Ajustements de charge structurelle (N3) — formulaire séparé côté client,
// jamais un champ éditable inline. Le marché n'est jamais accepté du corps de
// la requête : il vient exclusivement de req.workspaceMarket (résolu par
// resolveRequestedMarket + attachAuthorizedMarkets ci-dessus). scope_kind est
// forcé à MARKET_DIRECT ici — un market_operator ne peut jamais écrire un
// fait GROUP (mutualisé), qui affecte tous les marchés.
router.get('/market/:marketCode/charges', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    const { rows } = await db.query(
      `SELECT id, family, name, is_active, recurrence_period
         FROM charges
        WHERE is_active = TRUE
        ORDER BY family, name`
    );
    res.json({ charges: rows });
  } catch (error) { handleError(error, res, next); }
});

router.get('/market/:marketCode/structure-events', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    const events = await pricingPeriodStructure.listStructureCostEvents({
      chargeId: req.query.charge_id || null,
      scopeKind: pricingPeriodStructure.SCOPE_KINDS.MARKET_DIRECT,
      marketId: req.workspaceMarket.id,
      limit: req.query.limit,
    });
    res.json({ events });
  } catch (error) { handleStructureEventError(error, res, next); }
});

router.post('/market/:marketCode/structure-events', requireMarketPricingManager, async (req, res, next) => {
  try {
    const body = req.body || {};
    const event = await pricingPeriodStructure.recordStructureCostEvent(
      {
        ...body,
        scope_kind: pricingPeriodStructure.SCOPE_KINDS.MARKET_DIRECT,
        market_id: req.workspaceMarket.id,
      },
      req.user.id
    );
    sendAction(res, 'record_structure_cost_event', event, 201);
  } catch (error) { handleStructureEventError(error, res, next); }
});

function handleStructureEventError(error, res, next) {
  const message = String(error && error.message || '');
  if (message === 'charge not found') {
    return res.status(404).json({ error: 'Charge introuvable', code: 'structure_event_charge_not_found' });
  }
  if (message === 'market not found or inactive') {
    return res.status(404).json({ error: 'Marché introuvable ou inactif', code: 'market_not_found' });
  }
  if (message === 'adjusted event not found') {
    return res.status(404).json({ error: 'Fait à corriger introuvable', code: 'structure_event_not_found' });
  }
  if (
    message.endsWith('is required')
    || message.includes('must be')
    || message.includes('length must be')
    || message.includes('invalid')
    || message.includes('cannot')
    || message.includes('requires')
    || message.includes('inconsistent')
  ) {
    return res.status(400).json({ error: message, code: 'structure_event_invalid' });
  }
  return handleError(error, res, next);
}

// Global Pricing remains a distinct central authority. A market_operator can
// never fall through to these routes because the role guard is admin-only.
router.use(authenticate, requireRole(['admin']), requirePricingGlobalAuthority, rejectBrowserAuthority);

// Ajustements de charge structurelle mutualisée (N3, scope GROUP) — admin
// only : un fait GROUP affecte la quote-part de tous les marchés à la fois,
// jamais un seul. market_id est toujours forcé à null ici, quel que soit le
// corps envoyé — server_market_scope_is_authority.
router.get('/structure-events', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    const events = await pricingPeriodStructure.listStructureCostEvents({
      chargeId: req.query.charge_id || null,
      scopeKind: pricingPeriodStructure.SCOPE_KINDS.GROUP,
      limit: req.query.limit,
    });
    res.json({ events });
  } catch (error) { handleStructureEventError(error, res, next); }
});

router.post('/structure-events', async (req, res, next) => {
  try {
    const body = req.body || {};
    const event = await pricingPeriodStructure.recordStructureCostEvent(
      {
        ...body,
        scope_kind: pricingPeriodStructure.SCOPE_KINDS.GROUP,
        market_id: null,
      },
      req.user.id
    );
    sendAction(res, 'record_structure_cost_event', event, 201);
  } catch (error) { handleStructureEventError(error, res, next); }
});

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

router.post('/simulate-impact', async (req, res, next) => {
  try { sendAction(res, 'simulate_impact', await workspace.simulateImpact(req.body || {})); }
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

router._decorateMarketDecision = decorateMarketDecision;
router._projectedDaysToBreakEven = marketDecisionProjection._projectDays;

module.exports = router;