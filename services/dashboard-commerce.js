/**
 * @komerce-arch
 * @role          canonical-commerce-dashboard-service
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   high
 * @inputs        dashboard_period, server_resolved_market
 * @outputs       canonical_commerce_projection, market_product_viability, market_product_availability, server_decision_signals
 * @depends       db, dashboard-metrics, dashboard-metrics/_helpers, pricing-market-corridor, local-stock-service
 * @used-by       routes/admin-dashboard-market.js
 * @db-read       orders, order_items, products, order_item_cost_imputations, order_item_real_cost_allocations
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, server_market_scope_is_authority, decision_support_reuses_canonical_economic_engine, local_stock_service_is_availability_authority
 * @impact-areas  admin-dashboard, commerce, market-authorization, economic-engine, local-stock, decision-signals
 * @version       2026-09
 */

'use strict';

const db = require('../db');
const metrics = require('./dashboard-metrics');
const pricingMarketCorridor = require('./pricing-market-corridor');
const localStock = require('./local-stock-service');
const {
  buildFiltersClause,
  makeKpi,
  EXPECTED_VARIABLE_COSTS,
  EXPECTED_FIXED_COSTS,
  EXPECTED_PAYMENT_COSTS,
} = require('./dashboard-metrics/_helpers');

const ALLOWED_PERIODS = Object.freeze([7, 30, 90]);
const EXPECTED_COST_TYPES = Object.freeze([
  ...EXPECTED_VARIABLE_COSTS,
  ...EXPECTED_FIXED_COSTS,
  ...EXPECTED_PAYMENT_COSTS,
]);
const VIABILITY_PRIORITY = Object.freeze({
  NON_VIABLE_STRUCTURAL: 10,
  VIABLE_UNDER_CONDITIONS: 20,
  MARKET_EVIDENCE_INSUFFICIENT: 50,
  VIABLE: 90,
});
const LOCAL_AVAILABILITY_STATE = Object.freeze({
  NO_LOCAL_STOCK: 'NO_LOCAL_STOCK',
  LOCAL_NOT_EXPOSED: 'LOCAL_NOT_EXPOSED',
  AVAILABLE_NOW: 'AVAILABLE_NOW',
  LOCAL_EXPOSED_UNAVAILABLE: 'LOCAL_EXPOSED_UNAVAILABLE',
});

function normalizePeriod(value) {
  const parsed = Number.parseInt(value, 10);
  return ALLOWED_PERIODS.includes(parsed) ? parsed : 30;
}

function buildPeriodFilters(query = {}, marketId = null, now = new Date()) {
  const period = normalizePeriod(query.period);
  const to = new Date(now);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - period);

  return {
    period,
    filters: {
      from: from.toISOString(),
      to: to.toISOString(),
      ...(marketId ? { market_id: marketId } : {}),
    },
  };
}

async function getPanierMoyen(filters) {
  const { where, params } = buildFiltersClause(filters);
  const { rows } = await db.query(`
    SELECT COALESCE(AVG(o.total_kmf), 0)::bigint AS value,
           COUNT(*)::int AS items_total
    FROM orders o
    WHERE ${where}
      AND o.payment_status = 'paid'
      AND o.status NOT IN ('cancelled', 'refunded')
  `, params);

  const value = Number(rows[0] && rows[0].value) || 0;
  const itemsTotal = Number(rows[0] && rows[0].items_total) || 0;
  return makeKpi('panier_moyen', 'Panier moyen encaissé', value, 'KMF', {
    itemsTotal,
    itemsWithData: itemsTotal,
    drillTo: '/admin/operations?payment_status=paid',
  });
}

async function getTopProducts(filters) {
  const { where, params } = buildFiltersClause(filters);
  const { rows } = await db.query(`
    SELECT
      p.id AS product_id,
      p.product_ref,
      p.name,
      p.category,
      COALESCE(SUM(oi.quantity), 0)::int AS quantity,
      COALESCE(SUM(oi.price_kmf * oi.quantity), 0)::bigint AS revenue_kmf
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    JOIN orders o ON o.id = oi.order_id
    WHERE ${where}
      AND o.payment_status = 'paid'
      AND o.status NOT IN ('cancelled', 'refunded')
    GROUP BY p.id, p.product_ref, p.name, p.category
    ORDER BY revenue_kmf DESC
    LIMIT 5
  `, params);

  return rows.map(row => ({
    product_id: row.product_id || null,
    product_ref: row.product_ref || null,
    name: row.name || 'Produit',
    category: row.category || '—',
    quantity: Number(row.quantity) || 0,
    revenue_kmf: Number(row.revenue_kmf) || 0,
  }));
}

function publicTopProduct(product = {}) {
  return Object.freeze({
    product_ref: product.product_ref || null,
    name: product.name || 'Produit',
    category: product.category || '—',
    quantity: Number(product.quantity) || 0,
    revenue_kmf: Number(product.revenue_kmf) || 0,
  });
}

async function getProductProfitability(filters, options = {}) {
  const limit = Math.min(50, Math.max(1, Number(options.limit) || 10));
  const { where, params } = buildFiltersClause(filters, 'o');
  const expectedIndex = params.length + 1;
  const limitIndex = params.length + 2;
  const queryParams = [...params, EXPECTED_COST_TYPES, limit];
  const expectedCount = EXPECTED_COST_TYPES.length;

  const { rows } = await db.query(`
    WITH scoped_orders AS (
      SELECT o.id
      FROM orders o
      WHERE ${where}
        AND o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled', 'refunded')
    ),
    order_cost_status AS (
      SELECT
        so.id,
        EXISTS (
          SELECT 1
          FROM order_item_cost_imputations imp
          WHERE imp.order_id = so.id
        ) AS has_imputation,
        (
          SELECT COUNT(DISTINCT alc.cost_type::text)
          FROM order_item_real_cost_allocations alc
          WHERE alc.order_id = so.id
            AND alc.is_actual = TRUE
            AND alc.cost_type::text = ANY($${expectedIndex}::text[])
        )::int AS expected_cost_types
      FROM scoped_orders so
    ),
    item_truth AS (
      SELECT
        oi.order_id,
        oi.product_id,
        p.product_ref,
        p.name AS product_name,
        p.category,
        oi.quantity,
        (oi.price_kmf * oi.quantity)::bigint AS sale_total_kmf,
        (SELECT SUM(imp.estimated_business_complete_cost_kmf)
         FROM order_item_cost_imputations imp
         WHERE imp.order_item_id = oi.id) AS estimated_cost_kmf,
        (SELECT SUM(alc.amount_kmf)
         FROM order_item_real_cost_allocations alc
         WHERE alc.order_item_id = oi.id
           AND alc.is_actual = TRUE) AS real_cost_kmf,
        (ocs.has_imputation = TRUE AND ocs.expected_cost_types = ${expectedCount}) AS is_actual_order
      FROM scoped_orders so
      JOIN order_cost_status ocs ON ocs.id = so.id
      JOIN order_items oi ON oi.order_id = so.id
      JOIN products p ON p.id = oi.product_id
    )
    SELECT
      product_id,
      product_ref,
      product_name,
      category,
      COUNT(DISTINCT order_id)::int AS orders,
      COALESCE(SUM(quantity), 0)::int AS quantity,
      COALESCE(SUM(sale_total_kmf), 0)::bigint AS revenue_kmf,
      SUM(estimated_cost_kmf)::bigint AS estimated_cost_kmf,
      COUNT(DISTINCT order_id) FILTER (WHERE is_actual_order)::int AS actual_orders,
      SUM(sale_total_kmf) FILTER (WHERE is_actual_order)::bigint AS actual_revenue_kmf,
      SUM(real_cost_kmf) FILTER (WHERE is_actual_order)::bigint AS real_cost_kmf
    FROM item_truth
    GROUP BY product_id, product_ref, product_name, category
    ORDER BY revenue_kmf DESC, product_name ASC
    LIMIT $${limitIndex}
  `, queryParams);

  return rows.map(row => {
    const orders = Number(row.orders) || 0;
    const actualOrders = Number(row.actual_orders) || 0;
    const revenue = Number(row.revenue_kmf) || 0;
    const estimatedCost = row.estimated_cost_kmf == null ? null : Number(row.estimated_cost_kmf);
    const actualRevenue = row.actual_revenue_kmf == null ? null : Number(row.actual_revenue_kmf);
    const realCost = row.real_cost_kmf == null ? null : Number(row.real_cost_kmf);

    return Object.freeze({
      product_ref: row.product_ref || null,
      name: row.product_name || 'Produit',
      category: row.category || '—',
      orders,
      quantity: Number(row.quantity) || 0,
      revenue_kmf: revenue,
      estimated_cost_kmf: estimatedCost,
      estimated_margin_kmf: estimatedCost == null ? null : revenue - estimatedCost,
      real_cost_kmf: actualOrders > 0 ? realCost : null,
      consolidated_margin_kmf: actualOrders > 0 && actualRevenue != null && realCost != null
        ? actualRevenue - realCost
        : null,
      actual_orders: actualOrders,
      cost_coverage_pct: orders > 0 ? Number(((actualOrders / orders) * 100).toFixed(1)) : null,
    });
  });
}

async function getCategoryPerformance(filters) {
  const { where, params } = buildFiltersClause(filters);
  const { rows } = await db.query(`
    SELECT
      COALESCE(p.category, 'Non classé') AS category,
      COUNT(DISTINCT o.id)::int AS orders,
      COALESCE(SUM(oi.quantity), 0)::int AS quantity,
      COALESCE(SUM(oi.price_kmf * oi.quantity), 0)::bigint AS revenue_kmf
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    JOIN orders o ON o.id = oi.order_id
    WHERE ${where}
      AND o.payment_status = 'paid'
      AND o.status NOT IN ('cancelled', 'refunded')
    GROUP BY COALESCE(p.category, 'Non classé')
    ORDER BY revenue_kmf DESC
  `, params);

  return rows.map(row => ({
    category: row.category,
    orders: Number(row.orders) || 0,
    quantity: Number(row.quantity) || 0,
    revenue_kmf: Number(row.revenue_kmf) || 0,
  }));
}

async function getOrderFunnel(filters) {
  const { where, params } = buildFiltersClause(filters);
  const { rows } = await db.query(`
    SELECT
      COUNT(*)::int AS created,
      COUNT(*) FILTER (WHERE o.payment_status = 'paid')::int AS paid,
      COUNT(*) FILTER (WHERE o.status IN ('shipped', 'in_transit', 'available', 'collected'))::int AS shipped,
      COUNT(*) FILTER (WHERE o.status IN ('available', 'collected'))::int AS available,
      COUNT(*) FILTER (WHERE o.status = 'collected')::int AS collected,
      COUNT(*) FILTER (WHERE o.status IN ('cancelled', 'refunded'))::int AS lost
    FROM orders o
    WHERE ${where}
  `, params);

  const row = rows[0] || {};
  const created = Number(row.created) || 0;
  const step = (id, label, value) => ({
    id,
    label,
    count: Number(value) || 0,
    pct: created > 0 ? Number((((Number(value) || 0) / created) * 100).toFixed(1)) : 0,
  });

  return {
    steps: [
      step('created', 'Commandes créées', created),
      step('paid', 'Payées', row.paid),
      step('shipped', 'Expédiées', row.shipped),
      step('available', 'Disponibles relais', row.available),
      step('collected', 'Retirées', row.collected),
    ],
    lost: Number(row.lost) || 0,
  };
}

function projectViability(product, corridor) {
  const viability = corridor?.corridor?.local?.viability;
  if (!viability || !viability.status) return null;
  return Object.freeze({
    product_ref: product.product_ref,
    name: product.name,
    category: product.category,
    quantity: product.quantity,
    revenue_kmf: product.revenue_kmf,
    status: viability.status,
    label: viability.label || viability.status,
    reason: viability.reason || null,
    sourcing_action: viability.sourcing_action || null,
    market_confidence: viability.market_confidence || corridor?.corridor?.local?.confidence || 'none',
    market_prices_kmf: viability.market_prices_kmf || null,
    contribution_scenarios_kmf: viability.contribution_scenarios_kmf || null,
    purchase_cost_kmf: viability.purchase_cost_kmf ?? null,
    purchase_cost_ceiling_at_target_kmf: viability.purchase_cost_ceiling_at_target_kmf || null,
    purchase_cost_gap_to_safe_ceiling_kmf: viability.purchase_cost_gap_to_safe_ceiling_kmf ?? null,
    resilience: viability.resilience || null,
    authority: viability.authority || 'SERVER_DERIVED_DECISION_SUPPORT_NOT_GATE',
  });
}

async function getTopProductViability(topProducts = [], market = null, options = {}) {
  if (!market || !market.id || !market.code) {
    return Object.freeze({ items: Object.freeze([]), warnings: Object.freeze([]) });
  }
  const buildMarketCorridor = options.buildMarketCorridor || pricingMarketCorridor.buildMarketCorridor;
  const products = topProducts.filter(product => product && product.product_ref);
  const projected = await Promise.all(products.map(async product => {
    try {
      const corridor = await buildMarketCorridor({ market, productRef: product.product_ref });
      return { item: projectViability(product, corridor), warning: null };
    } catch (error) {
      return {
        item: null,
        warning: Object.freeze({
          code: 'commerce_product_viability_unavailable',
          product_ref: product.product_ref,
          message: error && error.message ? String(error.message) : 'Projection de viabilité indisponible.',
        }),
      };
    }
  }));

  return Object.freeze({
    items: Object.freeze(projected.map(result => result.item).filter(Boolean)),
    warnings: Object.freeze(projected.map(result => result.warning).filter(Boolean)),
  });
}

async function getTopProductAvailability(topProducts = [], market = null, options = {}) {
  if (!market || !market.id || !market.code) {
    return Object.freeze({ items: Object.freeze([]), warnings: Object.freeze([]) });
  }
  const getLocalStock = options.getLocalStock || localStock.getLocalStock;
  const isStockExposable = options.isStockExposable || localStock.isStockExposable;
  const products = topProducts.filter(product => product && product.product_id && product.product_ref);
  const projected = await Promise.all(products.map(async product => {
    try {
      const row = await getLocalStock(product.product_id, market.id);
      let state = LOCAL_AVAILABILITY_STATE.NO_LOCAL_STOCK;
      let exposure = null;
      if (row) {
        exposure = row.commercial_exposure || null;
        if (exposure !== 'ENABLED') {
          state = LOCAL_AVAILABILITY_STATE.LOCAL_NOT_EXPOSED;
        } else {
          const exposable = await isStockExposable(product.product_id, market.id);
          state = exposable
            ? LOCAL_AVAILABILITY_STATE.AVAILABLE_NOW
            : LOCAL_AVAILABILITY_STATE.LOCAL_EXPOSED_UNAVAILABLE;
        }
      }
      return {
        item: Object.freeze({
          product_ref: product.product_ref,
          name: product.name,
          category: product.category,
          quantity: product.quantity,
          revenue_kmf: product.revenue_kmf,
          state,
          commercial_exposure: exposure,
          authority: 'LOCAL_STOCK_SERVICE',
        }),
        warning: null,
      };
    } catch (error) {
      return {
        item: null,
        warning: Object.freeze({
          code: 'commerce_product_availability_unavailable',
          product_ref: product.product_ref,
          message: error && error.message ? String(error.message) : 'Projection de disponibilité locale indisponible.',
        }),
      };
    }
  }));

  return Object.freeze({
    items: Object.freeze(projected.map(result => result.item).filter(Boolean)),
    warnings: Object.freeze(projected.map(result => result.warning).filter(Boolean)),
  });
}

function projectDecisionSignal(signal, market) {
  const marketCode = market && market.code ? market.code : null;
  return Object.freeze({
    ...signal,
    signal_type: signal.kind,
    title: signal.label,
    summary: signal.helper || null,
    recommendation: signal.action || null,
    confidence: signal.confidence || 'high',
    owner_role: signal.owner_role || (marketCode ? 'market_operator' : 'admin'),
    source_module: signal.source || 'dashboard-commerce',
    scope: Object.freeze(marketCode
      ? { mode: 'market', market_code: marketCode }
      : { mode: 'global' }),
    lifecycle: Object.freeze({ mode: 'projection_only', persisted: false }),
  });
}

function viabilitySignal(row, market) {
  const status = row && row.status;
  if (!status || status === 'VIABLE') return null;
  const base = {
    key: `sku-viability:${row.product_ref}`,
    product_ref: row.product_ref,
    helper: `${row.name || row.product_ref}${row.reason ? ` · ${row.reason}` : ''}`,
    value: row.name || row.product_ref,
    source: 'pricing_market_corridor',
    evidence: Object.freeze({
      market_confidence: row.market_confidence || 'none',
      revenue_kmf: row.revenue_kmf ?? null,
      contribution_scenarios_kmf: row.contribution_scenarios_kmf || null,
      purchase_cost_gap_to_safe_ceiling_kmf: row.purchase_cost_gap_to_safe_ceiling_kmf ?? null,
    }),
    destination: market && market.code
      ? Object.freeze({ kind: 'pricing_workspace', market_code: market.code, product_ref: row.product_ref })
      : null,
  };
  if (status === 'NON_VIABLE_STRUCTURAL') {
    return projectDecisionSignal({ ...base, kind: 'sku_non_viable', severity: 'critical', label: 'SKU non viable', action: 'AVOID_OR_RESOURCE' }, market);
  }
  if (status === 'VIABLE_UNDER_CONDITIONS') {
    return projectDecisionSignal({ ...base, kind: 'sku_viable_under_conditions', severity: 'warning', label: 'SKU à renégocier / repositionner', action: row.sourcing_action || 'RENEGOTIATE_OR_REPOSITION' }, market);
  }
  if (status === 'MARKET_EVIDENCE_INSUFFICIENT') {
    return projectDecisionSignal({ ...base, kind: 'market_evidence_insufficient', severity: 'info', label: 'Preuve marché insuffisante', action: 'COLLECT_MARKET_EVIDENCE' }, market);
  }
  return null;
}

function availabilitySignal(row, market) {
  if (!row || row.state !== LOCAL_AVAILABILITY_STATE.LOCAL_EXPOSED_UNAVAILABLE) return null;
  return projectDecisionSignal({
    key: `best-seller-local-unavailable:${row.product_ref}`,
    kind: 'best_seller_local_unavailable',
    severity: 'warning',
    label: 'Best-seller sans disponibilité immédiate',
    helper: `${row.name || row.product_ref} · stock local exposé sans unité immédiatement disponible ; l’import peut rester disponible.`,
    value: row.name || row.product_ref,
    product_ref: row.product_ref,
    source: 'local_stock_service',
    action: 'REVIEW_LOCAL_STOCK',
    evidence: Object.freeze({
      state: row.state,
      revenue_kmf: row.revenue_kmf ?? null,
      quantity: row.quantity ?? null,
      commercial_exposure: row.commercial_exposure || null,
    }),
    destination: market && market.code
      ? Object.freeze({ kind: 'market_catalog', market_code: market.code, product_ref: row.product_ref })
      : null,
  }, market);
}

function buildDecisionSignals({ funnel, productProfitability, margin, productViability, productAvailability, market } = {}) {
  const ranked = [];
  for (const row of Array.isArray(productViability) ? productViability : []) {
    const signal = viabilitySignal(row, market);
    if (signal) ranked.push({ rank: VIABILITY_PRIORITY[row.status] ?? 80, signal });
  }
  for (const row of Array.isArray(productAvailability) ? productAvailability : []) {
    const signal = availabilitySignal(row, market);
    if (signal) ranked.push({ rank: 18, signal });
  }

  const marginValue = Number(margin && margin.value);
  if (Number.isFinite(marginValue) && marginValue < 0) {
    ranked.push({
      rank: 15,
      signal: projectDecisionSignal({
        key: 'negative-margin', kind: 'negative_margin', severity: 'critical',
        label: 'Marge négative', helper: 'Marge consolidée de la période', value_kmf: marginValue,
        source: 'dashboard_metrics', destination: null,
      }, market),
    });
  }

  const lost = Number(funnel && funnel.lost);
  if (Number.isFinite(lost) && lost > 0) {
    ranked.push({
      rank: 30,
      signal: projectDecisionSignal({
        key: 'orders-lost', kind: 'orders_lost', severity: 'critical',
        label: 'Commandes perdues', helper: 'Perte explicitement remontée par le funnel', value_count: lost,
        source: 'commerce_funnel', destination: Object.freeze({ kind: 'commerce_funnel' }),
      }, market),
    });
  }

  const incomplete = (Array.isArray(productProfitability) ? productProfitability : []).filter(row => {
    if (!row) return false;
    if (row.consolidated_margin_kmf == null) return true;
    const coverage = Number(row.cost_coverage_pct);
    return Number.isFinite(coverage) && coverage < 100;
  });
  if (incomplete.length) {
    ranked.push({
      rank: 40,
      signal: projectDecisionSignal({
        key: 'profitability-incomplete', kind: 'costing_incomplete', severity: 'warning',
        label: 'Costing incomplet', helper: 'Produits sans marge réelle complète', value_count: incomplete.length,
        source: 'commerce_product_profitability', destination: Object.freeze({ kind: 'commerce_profitability' }),
      }, market),
    });
  }

  return Object.freeze(ranked
    .sort((a, b) => a.rank - b.rank)
    .map(entry => entry.signal));
}

function publicScope(market) {
  if (!market) return Object.freeze({ mode: 'global', market: null });
  return Object.freeze({
    mode: 'market',
    market: Object.freeze({
      code: market.code,
      name: market.name,
      currency: market.currency,
    }),
  });
}

async function buildCommerce(query = {}, options = {}) {
  const market = options.market || null;
  const { period, filters } = buildPeriodFilters(query, market && market.id, options.now || new Date());

  const [ca, commandes, panier, marge, topProducts, productProfitability, categories, funnel] = await Promise.all([
    metrics.getCAEncaisse(filters),
    metrics.getCmdsCreees(filters),
    getPanierMoyen(filters),
    metrics.getMargeConsolidee(filters),
    getTopProducts(filters),
    getProductProfitability(filters, { limit: 10 }),
    getCategoryPerformance(filters),
    getOrderFunnel(filters),
  ]);
  const [viability, availability] = await Promise.all([
    getTopProductViability(topProducts, market, {
      buildMarketCorridor: options.buildMarketCorridor,
    }),
    getTopProductAvailability(topProducts, market, {
      getLocalStock: options.getLocalStock,
      isStockExposable: options.isStockExposable,
    }),
  ]);
  const decisionSignals = buildDecisionSignals({
    funnel,
    productProfitability,
    margin: marge,
    productViability: viability.items,
    productAvailability: availability.items,
    market,
  });
  const publicTopProducts = Object.freeze(topProducts.map(publicTopProduct));
  const warnings = Object.freeze([...viability.warnings, ...availability.warnings]);

  return Object.freeze({
    scope: publicScope(market),
    period,
    kpis: Object.freeze([ca, commandes, panier, marge]),
    top_products: publicTopProducts,
    product_profitability: Object.freeze(productProfitability),
    product_viability: viability.items,
    product_availability: availability.items,
    decision_signals: decisionSignals,
    categories: Object.freeze(categories),
    funnel: Object.freeze(funnel),
    data_quality: Object.freeze({
      generated_at: new Date(options.now || Date.now()).toISOString(),
      scope_enforced: true,
      scope_mode: market ? 'market' : 'global',
      product_real_margin_basis: 'actual_cost_orders_only',
      product_viability_basis: market ? 'market_price_corridor_local_evidence' : 'not_applicable_global',
      product_availability_basis: market ? 'local_stock_exposure_and_active_allocations' : 'not_applicable_global',
      decision_authority: 'server',
      decision_signal_contract: 'decision_signals_projection_only_v1',
      warnings,
      source_tables: Object.freeze([
        'orders',
        'order_items',
        'products',
        'order_item_cost_imputations',
        'order_item_real_cost_allocations',
      ]),
      source_features: Object.freeze(['economic-engine', 'local-stock']),
    }),
  });
}

module.exports = {
  ALLOWED_PERIODS,
  EXPECTED_COST_TYPES,
  VIABILITY_PRIORITY,
  LOCAL_AVAILABILITY_STATE,
  normalizePeriod,
  buildPeriodFilters,
  getPanierMoyen,
  getTopProducts,
  publicTopProduct,
  getProductProfitability,
  getCategoryPerformance,
  getOrderFunnel,
  projectViability,
  getTopProductViability,
  getTopProductAvailability,
  projectDecisionSignal,
  viabilitySignal,
  availabilitySignal,
  buildDecisionSignals,
  buildCommerce,
};