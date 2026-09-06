/**
 * @komerce-arch
 * @role          canonical-pricing-workspace-service
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        product_ref, competitor_ref, cost_component_key, simulation_payload, actor
 * @outputs       canonical_pricing_projection, global_economic_projection, delegated_mutation_results
 * @depends       db.js, services/pricing-engine.js, services/pricing-recommend.js, services/pricing-impact-simulation.js, services/pricing-rates.js, services/pricing-apply.js, services/pricing-strategy-service.js, services/cost-component-admin-service.js, services/pricing-cost-explainability.js, services/economic-engine-queries.js
 * @used-by       routes/admin-pricing-workspace.js
 * @db-read       products, competitor_prices, charges, economic_variables, economic_snapshots, finance_config
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_orchestrates_existing_pricing_authorities, browser_business_refs_only, every_cost_line_is_explainable, simulation_never_persists
 * @impact-areas  pricing, economic-engine, admin-dashboard, catalog
 * @version       2026-09
 */

'use strict';

const db = require('../db');
const pricingEngine = require('./pricing-engine');
const pricingRecommend = require('./pricing-recommend');
const pricingImpactSimulation = require('./pricing-impact-simulation');
const pricingRates = require('./pricing-rates');
const pricingApply = require('./pricing-apply');
const strategyService = require('./pricing-strategy-service');
const costComponents = require('./cost-component-admin-service');
const marketCostComponents = require('./cost-component-market-service');
const costExplainability = require('./pricing-cost-explainability');
const economicQueries = require('./economic-engine-queries');

class PricingWorkspaceError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.name = 'PricingWorkspaceError';
    this.status = status;
    this.code = code;
  }
}

function stripInternalIds(value) {
  if (Array.isArray(value)) return value.map(stripInternalIds);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    const lower = key.toLowerCase();
    const businessIds = new Set(['scenario_id']);
    if (lower === 'id' || lower === 'ids' || lower.endsWith('_by') || lower.endsWith('_uuid') || ((lower.endsWith('_id') || lower.endsWith('_ids')) && !businessIds.has(lower))) continue;
    out[key] = stripInternalIds(item);
  }
  return out;
}

async function resolveProductRef(productRef, q = db) {
  const ref = String(productRef || '').trim();
  if (!ref) throw new PricingWorkspaceError(400, 'product_ref requis', 'pricing_product_ref_required');
  const { rows } = await q.query(
    `SELECT id, product_ref, name, category, price_kmf, cost_kmf, weight_kg, volume_m3, is_active
       FROM products
      WHERE product_ref = $1
      LIMIT 1`,
    [ref]
  );
  if (!rows.length) throw new PricingWorkspaceError(404, 'Produit introuvable', 'pricing_product_not_found');
  return rows[0];
}

async function resolveCompetitorRef(competitorRef, q = db) {
  const ref = String(competitorRef || '').trim();
  if (!ref) throw new PricingWorkspaceError(400, 'competitor_ref requis', 'pricing_competitor_ref_required');
  const { rows } = await q.query(
    `SELECT id, competitor_ref, product_id, category, competitor_name, price_kmf, observed_at, source, notes, is_active
       FROM competitor_prices
      WHERE competitor_ref = $1
      LIMIT 1`,
    [ref]
  );
  if (!rows.length) throw new PricingWorkspaceError(404, 'Observation concurrente introuvable', 'pricing_competitor_not_found');
  return rows[0];
}

function publicComponent(component) {
  const clean = stripInternalIds(component);
  delete clean.scope_value; // peut contenir un UUID historique selon le scope
  return clean;
}

function publicProduct(product) {
  return {
    product_ref: product.product_ref,
    name: product.name,
    category: product.category,
    price_kmf: Number(product.price_kmf) || 0,
    cost_kmf: Number(product.cost_kmf) || 0,
    weight_kg: product.weight_kg == null ? null : Number(product.weight_kg),
    volume_m3: product.volume_m3 == null ? null : Number(product.volume_m3),
    is_active: Boolean(product.is_active),
  };
}

function simulationProduct(product) {
  return {
    product_ref: product.product_ref,
    name: product.name,
    category: product.category,
    current_price_kmf: Number(product.price_kmf) || 0,
  };
}

async function buildWorkspace() {
  const [
    productRes,
    componentProjection,
    rates,
    competitorCountRes,
    economicExecutive,
    economicVariables,
    economicCharges,
  ] = await Promise.all([
    db.query(
      `SELECT id, product_ref, name, category, price_kmf, cost_kmf, weight_kg, volume_m3, is_active
         FROM products
        ORDER BY is_active DESC, updated_at DESC NULLS LAST, name
        LIMIT 250`
    ),
    costComponents.listComponents({}),
    pricingRates.getCurrentRates().catch(() => null),
    db.query('SELECT COUNT(*)::int AS count FROM competitor_prices WHERE is_active = TRUE'),
    economicQueries.buildExecutiveSummary().catch(() => null),
    economicQueries.getVariables().catch(() => null),
    economicQueries.getCharges().catch(() => null),
  ]);

  let recommendations = [];
  try {
    const batch = await pricingRecommend.computeRecommendBatch({ limit: 200 });
    const refsById = new Map(productRes.rows.map(product => [String(product.id), product.product_ref]));
    recommendations = (batch.items || []).map(item => {
      const clean = stripInternalIds(item);
      const productRef = refsById.get(String(item.product_id || ''));
      return productRef ? { product_ref: productRef, ...clean } : clean;
    });
  } catch (_) {
    recommendations = [];
  }

  const components = costExplainability.explainComponents(
    componentProjection.components.map(publicComponent)
  );
  const products = productRes.rows.map(publicProduct);
  return {
    scope: { mode: 'global_pricing' },
    summary: {
      products: products.length,
      active_products: products.filter(product => product.is_active).length,
      cost_components: components.length,
      active_cost_components: components.filter(component => component.is_active).length,
      competitor_observations: Number(competitorCountRes.rows[0]?.count) || 0,
    },
    products,
    simulation_products: products.filter(product => product.is_active).map(simulationProduct),
    recommendations,
    cost_components: components,
    cost_meta: costComponents.META,
    rates: stripInternalIds(rates),
    economic: stripInternalIds({
      scope: 'global_pricing',
      source_of_truth: 'economic-engine',
      executive: economicExecutive,
      variables: economicVariables,
      charges: economicCharges,
    }),
  };
}

async function simulationPayload(body = {}) {
  const payload = { ...body };
  delete payload.product_ref;
  if (body.product_ref) {
    const product = await resolveProductRef(body.product_ref);
    payload.product_id = product.id;
  }
  return payload;
}

async function simulate(body = {}) {
  return stripInternalIds(await pricingRecommend.computeRecommend(await simulationPayload(body)));
}

async function simulateImpact(body = {}, market = null) {
  const product = await resolveProductRef(body.product_ref);
  return stripInternalIds(await pricingImpactSimulation.simulate({ product, market, body }));
}

async function flow(body = {}) {
  return stripInternalIds(await pricingEngine.recommend(await simulationPayload(body)));
}

async function applyPrice(productRef, body = {}, actor = {}) {
  const product = await resolveProductRef(productRef);
  const delegated = await pricingApply.applyPrice(product.id, body, actor.id || null);
  if (delegated.status >= 400) throw new PricingWorkspaceError(delegated.status, delegated.body?.error || 'Application du prix refusée', delegated.body?.code || 'pricing_apply_failed');
  return {
    product_ref: product.product_ref,
    old_price_kmf: delegated.body.old_price_kmf,
    new_price_kmf: delegated.body.new_price_kmf,
    scenario_id: delegated.body.scenario_id || null,
    levier: delegated.body.levier || null,
  };
}

async function strategyTarget({ product_ref, category } = {}) {
  if (product_ref) {
    const product = await resolveProductRef(product_ref);
    return { product, args: { product_id: product.id } };
  }
  const cleanCategory = String(category || '').trim();
  if (!cleanCategory) throw new PricingWorkspaceError(400, 'product_ref ou category requis', 'pricing_strategy_target_required');
  return { product: null, args: { category: cleanCategory } };
}

async function getStrategy(target = {}) {
  const resolved = await strategyTarget(target);
  const strategy = await strategyService.getStrategy(db, resolved.args);
  const competitorsRaw = await strategyService.getCompetitors(db, resolved.args);
  const competitors = competitorsRaw.competitors.map(row => ({
    competitor_ref: row.competitor_ref,
    category: row.category,
    competitor_name: row.competitor_name,
    price_kmf: Number(row.price_kmf) || 0,
    observed_at: row.observed_at,
    source: row.source,
    notes: row.notes,
  }));
  const clean = stripInternalIds(strategy);
  if (clean.target && resolved.product) clean.target.product_ref = resolved.product.product_ref;
  return { strategy: clean, competitors };
}

async function applyStrategy(body = {}, actor = {}) {
  const resolved = await strategyTarget(body);
  const payload = { ...body, ...resolved.args };
  delete payload.product_ref;
  const result = await strategyService.applyStrategy(db, payload, actor.id || null);
  const clean = stripInternalIds(result);
  if (resolved.product) clean.product_ref = resolved.product.product_ref;
  return clean;
}

async function addCompetitor(body = {}) {
  const resolved = await strategyTarget(body);
  const payload = { ...body, ...resolved.args };
  delete payload.product_ref;
  const row = await strategyService.addCompetitor(db, payload);
  return {
    competitor_ref: row.competitor_ref,
    category: row.category,
    competitor_name: row.competitor_name,
    price_kmf: Number(row.price_kmf) || 0,
    observed_at: row.observed_at,
    source: row.source,
    notes: row.notes,
  };
}

async function deactivateCompetitor(competitorRef) {
  const row = await resolveCompetitorRef(competitorRef);
  await strategyService.softDeleteCompetitor(db, row.id);
  return { competitor_ref: row.competitor_ref, is_active: false };
}

async function createCostComponent(body = {}, actor = {}) {
  return publicComponent(await costComponents.createComponent(body, actor.id || null));
}

async function updateCostComponent(key, body = {}, actor = {}) {
  return publicComponent(await costComponents.updateComponent({ key }, body, actor.id || null));
}

async function toggleCostComponent(key, actor = {}) {
  return publicComponent(await costComponents.toggleComponent({ key }, actor.id || null));
}

async function buildMarketWorkspace({ market } = {}) {
  if (!market || !market.id || !market.code) {
    throw new PricingWorkspaceError(400, 'Marché Pricing requis', 'pricing_market_required');
  }
  const [effectiveComponents, productRes] = await Promise.all([
    marketCostComponents.listEffectiveComponents(market.id),
    db.query(
      `SELECT product_ref, name, category, price_kmf
         FROM products
        WHERE is_active = TRUE
        ORDER BY updated_at DESC NULLS LAST, name
        LIMIT 250`
    ),
  ]);
  const components = costExplainability.explainComponents(
    effectiveComponents.map(publicComponent),
    { marketCode: market.code }
  );
  return {
    scope: {
      mode: 'market_pricing',
      market_code: market.code,
      market_name: market.name,
      market_currency: market.currency,
      inherits_global: true,
    },
    summary: {
      cost_components: components.length,
      active_cost_components: components.filter(component => component.is_active).length,
      overridden_cost_components: components.filter(component => component.inherited === false).length,
    },
    simulation_products: productRes.rows.map(simulationProduct),
    cost_components: components,
    cost_meta: costComponents.META,
    capabilities: {
      simulation: true,
      cost_overrides: true,
      reset_to_global: true,
      create_components: false,
      product_price_mutation: false,
      strategy_mutation: false,
    },
  };
}

function marketOverridePayload(body = {}) {
  const payload = {};
  if (Object.prototype.hasOwnProperty.call(body, 'default_value')) payload.default_value = body.default_value;
  if (Object.prototype.hasOwnProperty.call(body, 'notes')) payload.notes = body.notes;
  return payload;
}

async function updateMarketCostComponent(market, key, body = {}, actor = {}) {
  if (!market || !market.id) throw new PricingWorkspaceError(400, 'Marché Pricing requis', 'pricing_market_required');
  return marketCostComponents.upsertOverride({
    marketId: market.id,
    key,
    body: marketOverridePayload(body),
    actorId: actor.id || null,
  });
}

async function toggleMarketCostComponent(market, key, actor = {}) {
  if (!market || !market.id) throw new PricingWorkspaceError(400, 'Marché Pricing requis', 'pricing_market_required');
  const components = await marketCostComponents.listEffectiveComponents(market.id);
  const current = components.find(component => component.key === key);
  if (!current) throw new PricingWorkspaceError(404, 'Composant introuvable', 'market_cost_component_not_found');
  return marketCostComponents.upsertOverride({
    marketId: market.id,
    key,
    body: { is_active: !current.is_active },
    actorId: actor.id || null,
  });
}

async function resetMarketCostComponent(market, key, actor = {}) {
  if (!market || !market.id) throw new PricingWorkspaceError(400, 'Marché Pricing requis', 'pricing_market_required');
  return marketCostComponents.resetOverride({ marketId: market.id, key, actorId: actor.id || null });
}

module.exports = {
  PricingWorkspaceError,
  stripInternalIds,
  resolveProductRef,
  resolveCompetitorRef,
  buildWorkspace,
  buildMarketWorkspace,
  simulate,
  simulateImpact,
  flow,
  applyPrice,
  getStrategy,
  applyStrategy,
  addCompetitor,
  deactivateCompetitor,
  createCostComponent,
  updateCostComponent,
  toggleCostComponent,
  updateMarketCostComponent,
  toggleMarketCostComponent,
  resetMarketCostComponent,
};
