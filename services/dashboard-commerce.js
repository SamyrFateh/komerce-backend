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
const { buildFiltersClause, makeKpi } = require('./dashboard-metrics/_helpers');

const ALLOWED_PERIODS = Object.freeze([7, 30, 90]);

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
    GROUP BY p.id, p.name, p.category
    ORDER BY revenue_kmf DESC
    LIMIT 5
  `, params);

  return rows.map(row => ({
    name: row.name || 'Produit',
    category: row.category || '—',
    quantity: Number(row.quantity) || 0,
    revenue_kmf: Number(row.revenue_kmf) || 0,
  }));
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

  const [ca, commandes, panier, marge, topProducts, categories, funnel] = await Promise.all([
    metrics.getCAEncaisse(filters),
    metrics.getCmdsCreees(filters),
    getPanierMoyen(filters),
    metrics.getMargeConsolidee(filters),
    getTopProducts(filters),
    getCategoryPerformance(filters),
    getOrderFunnel(filters),
  ]);

  return Object.freeze({
    scope: publicScope(market),
    period,
    kpis: Object.freeze([ca, commandes, panier, marge]),
    top_products: Object.freeze(topProducts),
    categories: Object.freeze(categories),
    funnel: Object.freeze(funnel),
    data_quality: Object.freeze({
      generated_at: new Date(options.now || Date.now()).toISOString(),
      scope_enforced: true,
      scope_mode: market ? 'market' : 'global',
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
  normalizePeriod,
  buildPeriodFilters,
  getPanierMoyen,
  getTopProducts,
  getCategoryPerformance,
  getOrderFunnel,
  buildCommerce,
};
