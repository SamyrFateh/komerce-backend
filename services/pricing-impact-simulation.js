/**
 * @komerce-arch
 * @role          economic-engine-pricing-impact-simulation
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        resolved_product, resolved_market_id, cost_line_overrides, simulation_context
 * @outputs       before_after_pricing_impact_without_persistence
 * @depends       services/pricing-engine.js, services/pricing-cost-explainability.js
 * @used-by       services/pricing-workspace.js
 * @db-read       indirect_via_pricing_engine_config_loader
 * @db-write      none
 * @db-txn        none
 * @doctrine      same_engine_for_observe_and_simulate, simulation_never_persists, explain_every_override
 * @impact-areas  pricing, economic-engine, admin-dashboard
 * @version       2026-09
 */

'use strict';

const pricingEngine = require('./pricing-engine');
const explainability = require('./pricing-cost-explainability');

class PricingImpactSimulationError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'PricingImpactSimulationError';
    this.status = status;
    this.code = code;
  }
}

const MAX_OVERRIDES = 20;
const DECISION_FIELDS = Object.freeze([
  'n1_landed_relay_cost_kmf',
  'n2_business_variable_cost_kmf',
  'variable_cost_complete_kmf',
  'contribution_kmf',
  'n3_fixed_overhead_allocation_kmf',
  'cdr_complete_kmf',
  'minimum_safe_price_kmf',
  'recommended_price_kmf',
  'final_price_kmf',
  'estimated_margin_pct',
  'monthly_break_even_orders',
]);

function cloneConfig(config = {}) {
  return {
    ...config,
    finance: { ...(config.finance || {}) },
    categories: Object.fromEntries(Object.entries(config.categories || {}).map(([key, value]) => [key, { ...value }])),
    components: (config.components || []).map(component => ({ ...component })),
    provisions: (config.provisions || []).map(item => ({ ...item })),
    charges: (config.charges || []).map(item => ({ ...item })),
    cost_benchmarks: (config.cost_benchmarks || []).map(item => ({ ...item })),
  };
}

function normalizeOverrides(raw = []) {
  if (!Array.isArray(raw)) {
    throw new PricingImpactSimulationError(400, 'overrides doit être une liste', 'pricing_simulation_overrides_invalid');
  }
  if (raw.length > MAX_OVERRIDES) {
    throw new PricingImpactSimulationError(400, `Maximum ${MAX_OVERRIDES} lignes par simulation`, 'pricing_simulation_too_many_overrides');
  }

  const seen = new Set();
  return raw.map((entry, index) => {
    const key = String(entry && entry.key || '').trim();
    if (!key) throw new PricingImpactSimulationError(400, `Clé manquante à l’override ${index + 1}`, 'pricing_simulation_override_key_required');
    if (seen.has(key)) throw new PricingImpactSimulationError(400, `Ligne dupliquée : ${key}`, 'pricing_simulation_override_duplicate');
    seen.add(key);
    const value = Number(entry.default_value);
    if (!Number.isFinite(value) || value < 0) {
      throw new PricingImpactSimulationError(400, `Valeur invalide pour ${key}`, 'pricing_simulation_override_value_invalid');
    }
    return { key, default_value: value };
  });
}

function applyOverrides(config, overrides, marketCode = null) {
  const scenario = cloneConfig(config);
  const components = new Map(scenario.components.map(component => [component.key, component]));
  const changes = [];

  for (const override of overrides) {
    const component = components.get(override.key);
    if (!component) {
      throw new PricingImpactSimulationError(400, `Ligne de coût active introuvable : ${override.key}`, 'pricing_simulation_component_not_active');
    }
    const before = Number(component.default_value) || 0;
    component.default_value = override.default_value;
    changes.push({
      key: component.key,
      label: component.label || component.key,
      unit: component.unit || null,
      before,
      after: override.default_value,
      delta: override.default_value - before,
      explainability: explainability.explainComponent(component, { marketCode }),
    });
  }
  return { scenario, changes };
}

function metricValue(result, field) {
  const value = result && result[field];
  return value == null || !Number.isFinite(Number(value)) ? null : Number(value);
}

function projectDecision(result = {}) {
  const metrics = {};
  DECISION_FIELDS.forEach(field => { metrics[field] = metricValue(result, field); });
  return {
    metrics,
    strategy_risk: result.strategy_risk || null,
    health_status: result.health_status || null,
    pricing_strategy: result.pricing_strategy || null,
    data_quality: result.data_quality || null,
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
  };
}

function computeDelta(before, after) {
  const delta = {};
  DECISION_FIELDS.forEach(field => {
    const a = before.metrics[field];
    const b = after.metrics[field];
    delta[field] = a == null || b == null ? null : Number((b - a).toFixed(2));
  });
  return delta;
}

function engineInput(product = {}, body = {}) {
  return {
    category: body.category || product.category || 'phones',
    channel: body.channel || 'cash_relais',
    cost_kmf: body.cost_kmf != null ? Number(body.cost_kmf) : Number(product.cost_kmf),
    weight_kg: body.weight_kg != null ? Number(body.weight_kg) : Number(product.weight_kg),
    volume_m3: body.volume_m3 != null ? Number(body.volume_m3) : Number(product.volume_m3),
    current_price_kmf: body.current_price_kmf != null ? Number(body.current_price_kmf) : Number(product.price_kmf),
    pricing_strategy: body.pricing_strategy || 'mechanical',
  };
}

async function simulate({ product, market = null, body = {} } = {}) {
  if (!product || !product.product_ref) {
    throw new PricingImpactSimulationError(400, 'Produit résolu requis', 'pricing_simulation_product_required');
  }
  const overrides = normalizeOverrides(body.overrides || []);
  const baseConfig = await pricingEngine.loadGlobalConfig(market && market.id ? { marketId: market.id } : {});
  const { scenario, changes } = applyOverrides(baseConfig, overrides, market && market.code || null);
  const input = engineInput(product, body);

  // Même moteur, même input, seule la config du scénario varie. Aucune écriture.
  const [baselineResult, scenarioResult] = await Promise.all([
    pricingEngine.recommend(input, { config: baseConfig }),
    pricingEngine.recommend(input, { config: scenario }),
  ]);
  const baseline = projectDecision(baselineResult);
  const after = projectDecision(scenarioResult);

  return {
    subject: {
      product_ref: product.product_ref,
      name: product.name || null,
      category: input.category,
      market_code: market && market.code || null,
    },
    source_of_truth: 'pricing-engine',
    persisted: false,
    overrides: changes,
    baseline,
    scenario: after,
    delta: computeDelta(baseline, after),
    generated_at: new Date().toISOString(),
  };
}

module.exports = {
  PricingImpactSimulationError,
  MAX_OVERRIDES,
  DECISION_FIELDS,
  cloneConfig,
  normalizeOverrides,
  applyOverrides,
  projectDecision,
  computeDelta,
  simulate,
};
