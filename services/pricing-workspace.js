/**
 * @komerce-arch
 * @role          canonical-pricing-workspace-service
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        product_ref, competitor_ref, cost_component_key, simulation_payload, actor
 * @outputs       canonical_pricing_projection, global_economic_projection, observed_cost_truth, delegated_mutation_results
 * @depends       db.js, services/pricing-engine.js, services/pricing-recommend.js, services/pricing-rates.js, services/pricing-apply.js, services/pricing-strategy-service.js, services/cost-component-admin-service.js, services/pricing-cost-explainability.js, services/economic-engine-queries.js
 * @used-by       routes/admin-pricing-workspace.js
 * @db-read       products, competitor_prices, charges, economic_variables, economic_snapshots, finance_config, order_item_real_cost_allocations, order_items, orders
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_orchestrates_existing_pricing_authorities, browser_business_refs_only, every_cost_line_is_explainable, simulation_never_persists, same_engine_before_after, observed_real_never_auto_promotes_config, market_observation_is_decisional_scope, group_observation_is_informational
 * @impact-areas  pricing, economic-engine, admin-dashboard, catalog
 * @version       2026-09
 */

'use strict';

const db = require('../db');
const pricingEngine = require('./pricing-engine');
const pricingRecommend = require('./pricing-recommend');
const pricingRates = require('./pricing-rates');
const pricingApply = require('./pricing-apply');
const strategyService = require('./pricing-strategy-service');
const costComponents = require('./cost-component-admin-service');
const marketCostComponents = require('./cost-component-market-service');
const costExplainability = require('./pricing-cost-explainability');
const economicQueries = require('./economic-engine-queries');

const MAX_SIMULATION_OVERRIDES = 20;
const OBSERVATION_WINDOW_DAYS = 90;
const OBSERVATION_TREND_DAYS = 30;
const PERIOD_TRUTH_CATEGORIES = new Set(['risk_provision', 'fixed_overhead']);
const REAL_COST_TYPE_BY_CATEGORY = Object.freeze({
  port_transitary: 'port_transitaire',
  marketing_campaign: 'marketing',
});
const SIMULATION_DECISION_FIELDS = Object.freeze([
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
  delete clean.scope_value;
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

function realCostTypeForComponent(component = {}) {
  return REAL_COST_TYPE_BY_CATEGORY[component.category] || component.category || null;
}

async function loadObservedCostRows({ marketId = null, q = db } = {}) {
  const params = [OBSERVATION_WINDOW_DAYS, OBSERVATION_TREND_DAYS, OBSERVATION_TREND_DAYS * 2];
  let marketClause = '';
  if (marketId) {
    params.push(marketId);
    marketClause = 'AND o.market_id = $4';
  }
  const { rows } = await q.query(
    `WITH actual AS (
       SELECT
         a.cost_type,
         a.order_id,
         a.order_item_id,
         a.parcel_id,
         a.shipment_id,
         a.amount_kmf,
         a.source,
         a.confidence,
         a.created_at,
         GREATEST(COALESCE(oi.quantity, 1), 1)::numeric AS quantity,
         CASE
           WHEN a.created_at >= NOW() - ($2::int * INTERVAL '1 day') THEN 'recent'
           WHEN a.created_at >= NOW() - ($3::int * INTERVAL '1 day') THEN 'previous'
           ELSE 'older'
         END AS bucket
       FROM order_item_real_cost_allocations a
       JOIN orders o ON o.id = a.order_id
       JOIN order_items oi ON oi.id = a.order_item_id
       WHERE a.is_actual = TRUE
         AND a.created_at >= NOW() - ($1::int * INTERVAL '1 day')
         ${marketClause}
     ),
     quantity_stats AS (
       SELECT cost_type, bucket, SUM(quantity)::numeric AS quantity
       FROM (
         SELECT DISTINCT cost_type, bucket, order_item_id, quantity
         FROM actual
       ) q_items
       GROUP BY cost_type, bucket
     ),
     bucket_stats AS (
       SELECT
         cost_type,
         bucket,
         SUM(amount_kmf)::numeric AS total_kmf,
         COUNT(*)::int AS allocations_count,
         COUNT(DISTINCT order_id)::int AS orders_count,
         COUNT(DISTINCT order_item_id)::int AS items_count,
         COUNT(DISTINCT parcel_id)::int AS parcels_count,
         COUNT(DISTINCT shipment_id)::int AS shipments_count,
         MAX(created_at) AS last_observed_at,
         MIN(CASE confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END)::int AS confidence_rank,
         STRING_AGG(DISTINCT COALESCE(NULLIF(source, ''), 'source_non_renseignee'), ', ') AS sources
       FROM actual
       GROUP BY cost_type, bucket
     )
     SELECT b.*, q.quantity
     FROM bucket_stats b
     LEFT JOIN quantity_stats q USING (cost_type, bucket)
     ORDER BY b.cost_type, b.bucket`,
    params
  );
  return rows;
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function splitSources(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function aggregateObservationRows(rows = []) {
  const sourceSet = new Set();
  let lastObservedAt = null;
  let confidenceRank = 3;
  const aggregate = {
    total_kmf: 0,
    allocations_count: 0,
    orders_count: 0,
    items_count: 0,
    parcels_count: 0,
    shipments_count: 0,
    quantity: 0,
  };
  rows.forEach(row => {
    aggregate.total_kmf += numberOrZero(row.total_kmf);
    aggregate.allocations_count += numberOrZero(row.allocations_count);
    aggregate.orders_count += numberOrZero(row.orders_count);
    aggregate.items_count += numberOrZero(row.items_count);
    aggregate.parcels_count += numberOrZero(row.parcels_count);
    aggregate.shipments_count += numberOrZero(row.shipments_count);
    aggregate.quantity += numberOrZero(row.quantity);
    splitSources(row.sources).forEach(source => sourceSet.add(source));
    if (row.last_observed_at && (!lastObservedAt || new Date(row.last_observed_at) > new Date(lastObservedAt))) {
      lastObservedAt = row.last_observed_at;
    }
    confidenceRank = Math.min(confidenceRank, Number(row.confidence_rank) || 1);
  });
  aggregate.last_observed_at = lastObservedAt;
  aggregate.confidence_rank = rows.length ? confidenceRank : null;
  aggregate.sources = [...sourceSet];
  return aggregate;
}

function observationDenominator(component = {}, row = {}) {
  const unit = component.unit || null;
  const method = component.allocation_method || 'none';
  const scope = component.scope || 'global';
  if (unit === 'kmf_per_order' || method === 'per_order' || scope === 'order') return { value: numberOrZero(row.orders_count), kind: 'order' };
  if (unit === 'kmf_per_parcel' || scope === 'parcel') return { value: numberOrZero(row.parcels_count), kind: 'parcel' };
  if (unit === 'kmf_per_shipment' || scope === 'shipment') return { value: numberOrZero(row.shipments_count), kind: 'shipment' };
  if (unit === 'kmf') return { value: numberOrZero(row.quantity), kind: 'item_quantity' };
  return { value: 0, kind: null };
}

function normalizeObservedValue(component = {}, row = null) {
  if (!row) return { value: null, comparable: false, denominator: null, reason: 'no_observation' };
  if (PERIOD_TRUTH_CATEGORIES.has(component.category)) {
    return { value: null, comparable: false, denominator: null, reason: 'period_truth_required' };
  }
  if (['pct', 'kmf_per_kg', 'kmf_per_m3', 'aed', 'eur', 'usd'].includes(component.unit)) {
    return { value: null, comparable: false, denominator: null, reason: 'unit_requires_matching_real_denominator' };
  }
  const denominator = observationDenominator(component, row);
  if (!denominator.value) {
    return { value: null, comparable: false, denominator, reason: 'real_denominator_missing' };
  }
  return {
    value: Number((numberOrZero(row.total_kmf) / denominator.value).toFixed(2)),
    comparable: true,
    denominator,
    reason: null,
  };
}

function confidenceFromRank(rank) {
  if (Number(rank) >= 3) return 'high';
  if (Number(rank) >= 2) return 'medium';
  if (Number(rank) >= 1) return 'low';
  return 'unknown';
}

function ageInDays(value, now = new Date()) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86400000));
}

function observationMaturity(component, aggregate, normalized, { marketScoped = false, now = new Date() } = {}) {
  if (PERIOD_TRUTH_CATEGORIES.has(component.category)) {
    return {
      state: 'period_required',
      label: 'Réconciliation de période requise',
      decisional: false,
      note: 'Cette ligne ne devient pas une vérité SKU par accumulation d’allocations commande. Elle doit être réconciliée au niveau de la période.',
    };
  }
  if (!aggregate.allocations_count) {
    return {
      state: 'unobserved',
      label: 'Pas encore observé',
      decisional: false,
      note: 'Aucune allocation réelle réconciliée dans la fenêtre d’observation.',
    };
  }
  if (!normalized.comparable) {
    return {
      state: 'observed_not_comparable',
      label: 'Réel présent · unité non comparable',
      decisional: false,
      note: 'Le montant réel existe, mais il manque une assiette réelle de même unité pour calculer un écart fiable.',
    };
  }
  const ageDays = ageInDays(aggregate.last_observed_at, now);
  const confidence = confidenceFromRank(aggregate.confidence_rank);
  let state = 'emerging';
  let label = 'Signal émergent';
  if (ageDays != null && ageDays > 60) {
    state = 'stale';
    label = 'Observation ancienne';
  } else if (aggregate.allocations_count >= 8 && confidence === 'high' && ageDays != null && ageDays <= 30) {
    state = 'mature';
    label = 'Réel mature';
  } else if (aggregate.allocations_count >= 3 && ageDays != null && ageDays <= 45) {
    state = 'usable';
    label = 'Réel exploitable avec prudence';
  }
  const decisional = marketScoped && ['usable', 'mature'].includes(state);
  return {
    state,
    label,
    decisional,
    note: marketScoped
      ? (decisional
        ? 'Le signal est assez alimenté pour éclairer une décision marché, sans application automatique.'
        : 'Le signal peut être simulé, mais il n’est pas encore assez mûr pour être traité comme une nouvelle référence.')
      : 'Agrégat groupe informatif : la décision économique doit être relue au niveau du marché avant toute modification.',
  };
}

function projectObservationTrend(component, bucketMap = {}) {
  const recent = normalizeObservedValue(component, bucketMap.recent || null);
  const previous = normalizeObservedValue(component, bucketMap.previous || null);
  if (!recent.comparable || !previous.comparable || previous.value == null || previous.value === 0) {
    return {
      direction: 'insufficient_history',
      pct: null,
      recent_value: recent.value,
      previous_value: previous.value,
    };
  }
  const pct = Number((((recent.value - previous.value) / previous.value) * 100).toFixed(2));
  return {
    direction: pct > 3 ? 'up' : pct < -3 ? 'down' : 'stable',
    pct,
    recent_value: recent.value,
    previous_value: previous.value,
  };
}

function projectCostObservation(component = {}, observedRows = [], context = {}) {
  const realCostType = realCostTypeForComponent(component);
  const matching = observedRows.filter(row => row.cost_type === realCostType);
  const bucketMap = Object.fromEntries(matching.map(row => [row.bucket, row]));
  const aggregate = aggregateObservationRows(matching);
  const currentRow = bucketMap.recent || bucketMap.previous || bucketMap.older || null;
  const normalized = normalizeObservedValue(component, currentRow);
  const estimated = Number(component.default_value);
  const estimatedValue = Number.isFinite(estimated) ? estimated : null;
  const varianceValue = normalized.comparable && normalized.value != null && estimatedValue != null
    ? Number((normalized.value - estimatedValue).toFixed(2))
    : null;
  const variancePct = varianceValue != null && estimatedValue !== 0
    ? Number(((varianceValue / estimatedValue) * 100).toFixed(2))
    : null;
  const currentBucketLabel = currentRow?.bucket === 'recent'
    ? '30 derniers jours'
    : currentRow?.bucket === 'previous'
      ? '31–60 jours'
      : currentRow?.bucket === 'older'
        ? '61–90 jours'
        : null;
  const maturity = observationMaturity(component, aggregate, normalized, {
    marketScoped: Boolean(context.marketId),
    now: context.now || new Date(),
  });
  return {
    source_of_truth: 'order_item_real_cost_allocations',
    source_scope: context.marketId ? 'market' : 'group',
    market_code: context.marketCode || null,
    real_cost_type: realCostType,
    observation_window_days: OBSERVATION_WINDOW_DAYS,
    trend_window_days: OBSERVATION_TREND_DAYS,
    estimated: {
      value: estimatedValue,
      unit: component.unit || null,
    },
    observed: {
      value: normalized.value,
      unit: component.unit || null,
      comparable: normalized.comparable,
      comparison_reason: normalized.reason,
      denominator: normalized.denominator,
      current_period: currentBucketLabel,
      current_total_kmf: currentRow ? Math.round(numberOrZero(currentRow.total_kmf)) : null,
      total_kmf_90d: aggregate.allocations_count ? Math.round(aggregate.total_kmf) : null,
      allocations_count: Math.round(aggregate.allocations_count),
      orders_count: Math.round(aggregate.orders_count),
      items_count: Math.round(aggregate.items_count),
      parcels_count: Math.round(aggregate.parcels_count),
      shipments_count: Math.round(aggregate.shipments_count),
      confidence: confidenceFromRank(aggregate.confidence_rank),
      sources: aggregate.sources,
      last_observed_at: aggregate.last_observed_at,
    },
    variance: {
      value: varianceValue,
      pct: variancePct,
      comparable: normalized.comparable && varianceValue != null,
    },
    trend: projectObservationTrend(component, bucketMap),
    maturity,
    simulation_candidate_value: normalized.comparable ? normalized.value : null,
    automatic_application_allowed: false,
    caution: normalized.comparable
      ? 'Le réel observé peut être testé dans le scénario. Il ne remplace jamais automatiquement la valeur configurée.'
      : (normalized.reason === 'period_truth_required'
        ? 'La vérité de cette ligne se juge sur une période économique, pas sur une commande isolée.'
        : 'Un réel existe éventuellement en KMF, mais aucun Δ n’est calculé tant que les unités ne sont pas strictement comparables.'),
  };
}

function attachCostObservations(components = [], observedRows = [], context = {}) {
  return components.map(component => ({
    ...component,
    observation: projectCostObservation(component, observedRows, context),
  }));
}

function clonePricingConfig(config = {}) {
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

function normalizeSimulationOverrides(raw = []) {
  if (!Array.isArray(raw)) {
    throw new PricingWorkspaceError(400, 'overrides doit être une liste', 'pricing_simulation_overrides_invalid');
  }
  if (raw.length > MAX_SIMULATION_OVERRIDES) {
    throw new PricingWorkspaceError(400, `Maximum ${MAX_SIMULATION_OVERRIDES} lignes par simulation`, 'pricing_simulation_too_many_overrides');
  }
  const seen = new Set();
  return raw.map((entry, index) => {
    const key = String(entry && entry.key || '').trim();
    if (!key) throw new PricingWorkspaceError(400, `Clé manquante à l’override ${index + 1}`, 'pricing_simulation_override_key_required');
    if (seen.has(key)) throw new PricingWorkspaceError(400, `Ligne dupliquée : ${key}`, 'pricing_simulation_override_duplicate');
    seen.add(key);
    const value = Number(entry.default_value);
    if (!Number.isFinite(value) || value < 0) {
      throw new PricingWorkspaceError(400, `Valeur invalide pour ${key}`, 'pricing_simulation_override_value_invalid');
    }
    return { key, default_value: value };
  });
}

function applySimulationOverrides(config, overrides, marketCode = null) {
  const scenario = clonePricingConfig(config);
  const components = new Map(scenario.components.map(component => [component.key, component]));
  const changes = [];
  for (const override of overrides) {
    const component = components.get(override.key);
    if (!component) {
      throw new PricingWorkspaceError(400, `Ligne de coût active introuvable : ${override.key}`, 'pricing_simulation_component_not_active');
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
      explainability: costExplainability.explainComponent(component, { marketCode }),
    });
  }
  return { scenario, changes };
}

function simulationMetric(result, field) {
  const value = result && result[field];
  return value == null || !Number.isFinite(Number(value)) ? null : Number(value);
}

function projectSimulationDecision(result = {}) {
  const metrics = {};
  SIMULATION_DECISION_FIELDS.forEach(field => { metrics[field] = simulationMetric(result, field); });
  return {
    metrics,
    strategy_risk: result.strategy_risk || null,
    health_status: result.health_status || null,
    pricing_strategy: result.pricing_strategy || null,
    data_quality: result.data_quality || null,
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
  };
}

function simulationDelta(before, after) {
  const delta = {};
  SIMULATION_DECISION_FIELDS.forEach(field => {
    const a = before.metrics[field];
    const b = after.metrics[field];
    delta[field] = a == null || b == null ? null : Number((b - a).toFixed(2));
  });
  return delta;
}

function simulationEngineInput(product = {}, body = {}) {
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

async function buildWorkspace() {
  const [
    productRes,
    componentProjection,
    rates,
    competitorCountRes,
    economicExecutive,
    economicVariables,
    economicCharges,
    observedRows,
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
    loadObservedCostRows(),
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

  const explainedComponents = costExplainability.explainComponents(componentProjection.components.map(publicComponent));
  const components = attachCostObservations(explainedComponents, observedRows);
  const products = productRes.rows.map(publicProduct);
  return {
    scope: { mode: 'global_pricing' },
    summary: {
      products: products.length,
      active_products: products.filter(product => product.is_active).length,
      cost_components: components.length,
      active_cost_components: components.filter(component => component.is_active).length,
      competitor_observations: Number(competitorCountRes.rows[0]?.count) || 0,
      observed_cost_lines: components.filter(component => component.observation?.observed?.allocations_count > 0).length,
      mature_observed_cost_lines: components.filter(component => component.observation?.maturity?.state === 'mature').length,
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
  const overrides = normalizeSimulationOverrides(body.overrides || []);
  const baseConfig = await pricingEngine.loadGlobalConfig(market && market.id ? { marketId: market.id } : {});
  const { scenario, changes } = applySimulationOverrides(baseConfig, overrides, market && market.code || null);
  const input = simulationEngineInput(product, body);
  const [baselineResult, scenarioResult] = await Promise.all([
    pricingEngine.recommend(input, { config: baseConfig }),
    pricingEngine.recommend(input, { config: scenario }),
  ]);
  const baseline = projectSimulationDecision(baselineResult);
  const after = projectSimulationDecision(scenarioResult);
  return stripInternalIds({
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
    delta: simulationDelta(baseline, after),
    generated_at: new Date().toISOString(),
  });
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
  const [effectiveComponents, productRes, observedRows] = await Promise.all([
    marketCostComponents.listEffectiveComponents(market.id),
    db.query(
      `SELECT product_ref, name, category, price_kmf
         FROM products
        WHERE is_active = TRUE
        ORDER BY updated_at DESC NULLS LAST, name
        LIMIT 250`
    ),
    loadObservedCostRows({ marketId: market.id }),
  ]);
  const explainedComponents = costExplainability.explainComponents(effectiveComponents.map(publicComponent), { marketCode: market.code });
  const components = attachCostObservations(explainedComponents, observedRows, { marketId: market.id, marketCode: market.code });
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
      observed_cost_lines: components.filter(component => component.observation?.observed?.allocations_count > 0).length,
      mature_observed_cost_lines: components.filter(component => component.observation?.maturity?.state === 'mature').length,
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
  return marketCostComponents.upsertOverride({ marketId: market.id, key, body: marketOverridePayload(body), actorId: actor.id || null });
}

async function toggleMarketCostComponent(market, key, actor = {}) {
  if (!market || !market.id) throw new PricingWorkspaceError(400, 'Marché Pricing requis', 'pricing_market_required');
  const components = await marketCostComponents.listEffectiveComponents(market.id);
  const current = components.find(component => component.key === key);
  if (!current) throw new PricingWorkspaceError(404, 'Composant introuvable', 'market_cost_component_not_found');
  return marketCostComponents.upsertOverride({ marketId: market.id, key, body: { is_active: !current.is_active }, actorId: actor.id || null });
}

async function resetMarketCostComponent(market, key, actor = {}) {
  if (!market || !market.id) throw new PricingWorkspaceError(400, 'Marché Pricing requis', 'pricing_market_required');
  return marketCostComponents.resetOverride({ marketId: market.id, key, actorId: actor.id || null });
}

module.exports = {
  PricingWorkspaceError,
  MAX_SIMULATION_OVERRIDES,
  OBSERVATION_WINDOW_DAYS,
  OBSERVATION_TREND_DAYS,
  REAL_COST_TYPE_BY_CATEGORY,
  SIMULATION_DECISION_FIELDS,
  stripInternalIds,
  resolveProductRef,
  resolveCompetitorRef,
  realCostTypeForComponent,
  loadObservedCostRows,
  aggregateObservationRows,
  normalizeObservedValue,
  observationMaturity,
  projectObservationTrend,
  projectCostObservation,
  attachCostObservations,
  clonePricingConfig,
  normalizeSimulationOverrides,
  applySimulationOverrides,
  projectSimulationDecision,
  simulationDelta,
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
