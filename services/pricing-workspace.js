/**
 * @komerce-arch
 * @role          canonical-pricing-workspace-service
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        product_ref, competitor_ref, cost_component_key, simulation_payload, actor
 * @outputs       canonical_pricing_projection, delegated_mutation_results
 * @depends       db.js, services/pricing-engine.js, services/pricing-recommend.js, services/pricing-rates.js, services/pricing-apply.js, services/pricing-strategy-service.js, services/cost-component-admin-service.js
 * @used-by       routes/admin-pricing-workspace.js
 * @db-read       products, competitor_prices
 * @db-write      none
 * @db-write-via:economic-engine delegated pricing/cost services
 * @db-txn        none
 * @doctrine      workspace_orchestrates_existing_pricing_authorities, browser_business_refs_only
 * @impact-areas  pricing, economic-engine, admin-dashboard, catalog
 * @version       2026-08
 */

'use strict';

const db = require('../db');
const pricingEngine = require('./pricing-engine');
const pricingRecommend = require('./pricing-recommend');
const pricingRates = require('./pricing-rates');
const pricingApply = require('./pricing-apply');
const strategyService = require('./pricing-strategy-service');
const costComponents = require('./cost-component-admin-service');

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
    if (lower === 'id' || lower === 'ids' || lower === 'product_id' || lower === 'competitor_id' || lower === 'component_id' || lower.endsWith('_uuid')) continue;
    out[key] = stripInternalIds(item);
  }
  return out;
}

async function resolveProductRef(productRef, q = db) {
  const ref = String(productRef || '').trim();
  if (!ref) throw new PricingWorkspaceError(400, 'product_ref requis', 'pricing_product_ref_required');
  const { rows } = await q.query(
    `SELECT id, product_ref, name, category, price_kmf, cost_kmf, weight_kg, is_active
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
  return stripInternalIds(component);
}

function publicProduct(product) {
  return {
    product_ref: product.product_ref,
    name: product.name,
    category: product.category,
    price_kmf: Number(product.price_kmf) || 0,
    cost_kmf: Number(product.cost_kmf) || 0,
    weight_kg: product.weight_kg == null ? null : Number(product.weight_kg),
    is_active: Boolean(product.is_active),
  };
}

async function buildWorkspace() {
  const [productRes, componentProjection, rates, competitorCountRes] = await Promise.all([
    db.query(
      `SELECT id, product_ref, name, category, price_kmf, cost_kmf, weight_kg, is_active
         FROM products
        ORDER BY is_active DESC, updated_at DESC NULLS LAST, name
        LIMIT 250`
    ),
    costComponents.listComponents({}),
    pricingRates.getCurrentRates().catch(() => null),
    db.query('SELECT COUNT(*)::int AS count FROM competitor_prices WHERE is_active = TRUE'),
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

  const components = componentProjection.components.map(publicComponent);
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
    recommendations,
    cost_components: components,
    cost_meta: costComponents.META,
    rates: stripInternalIds(rates),
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

module.exports = {
  PricingWorkspaceError,
  stripInternalIds,
  resolveProductRef,
  resolveCompetitorRef,
  buildWorkspace,
  simulate,
  flow,
  applyPrice,
  getStrategy,
  applyStrategy,
  addCompetitor,
  deactivateCompetitor,
  createCostComponent,
  updateCostComponent,
  toggleCostComponent,
};
