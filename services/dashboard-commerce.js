/**
 * @komerce-arch
 * @role          canonical-commerce-dashboard-service
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   high
 * @inputs        dashboard_period, server_resolved_market
 * @outputs       canonical_commerce_projection
 * @depends       db, dashboard-metrics, dashboard-metrics/_helpers
 * @used-by       routes/admin-dashboard-market.js
 * @db-read       orders, order_items, products, order_item_cost_imputations, order_item_real_cost_allocations
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, server_market_scope_is_authority
 * @impact-areas  admin-dashboard, commerce, market-authorization
 * @version       2026-09
 */

'use strict';

const db = require('../db');
const metrics = require('./dashboard-metrics');
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
    product_ref: row.product_ref || null,
    name: row.name || 'Produit',
    category: row.category || '—',
    quantity: Number(row.quantity) || 0,
    revenue_kmf: Number(row.revenue_kmf) || 0,
  }));
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

  return Object.freeze({
    scope: publicScope(market),
    period,
    kpis: Object.freeze([ca, commandes, panier, marge]),
    top_products: Object.freeze(topProducts),
    product_profitability: Object.freeze(productProfitability),
    categories: Object.freeze(categories),
    funnel: Object.freeze(funnel),
    data_quality: Object.freeze({
      generated_at: new Date(options.now || Date.now()).toISOString(),
      scope_enforced: true,
      scope_mode: market ? 'market' : 'global',
      product_real_margin_basis: 'actual_cost_orders_only',
      source_tables: Object.freeze([
        'orders',
        'order_items',
        'products',
        'order_item_cost_imputations',
        'order_item_real_cost_allocations',
      ]),
    }),
  });
}

module.exports = {
  ALLOWED_PERIODS,
  EXPECTED_COST_TYPES,
  normalizePeriod,
  buildPeriodFilters,
  getPanierMoyen,
  getTopProducts,
  getProductProfitability,
  getCategoryPerformance,
  getOrderFunnel,
  buildCommerce,
};
