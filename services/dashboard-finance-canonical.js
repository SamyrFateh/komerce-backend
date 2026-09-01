/**
 * @komerce-arch
 * @role          canonical-finance-dashboard-service
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   high
 * @inputs        dashboard_period, server_resolved_market
 * @outputs       canonical_finance_projection
 * @depends       db, dashboard-metrics, dashboard-metrics/_helpers
 * @used-by       routes/admin-dashboard-market.js
 * @db-read       orders, refunds, order_items, order_item_cost_imputations, order_item_real_cost_allocations
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, server_market_scope_is_authority, finance_event_date_is_authoritative
 * @impact-areas  admin-dashboard, finance, economic-engine, market-authorization
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

function buildPeriod(query = {}, marketId = null, now = new Date()) {
  const period = normalizePeriod(query.period);
  const to = new Date(now);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - period);

  return Object.freeze({
    period,
    from: from.toISOString(),
    to: to.toISOString(),
    filters: Object.freeze({
      from: from.toISOString(),
      to: to.toISOString(),
      ...(marketId ? { market_id: marketId } : {}),
    }),
  });
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

async function getRefunds(periodWindow, market = null) {
  const params = [periodWindow.from, periodWindow.to];
  let marketClause = '';
  if (market && market.id) {
    params.push(market.id);
    marketClause = `AND o.market_id = $${params.length}`;
  }

  const { rows } = await db.query(`
    SELECT
      COUNT(*)::int AS count,
      COALESCE(SUM(r.amount_kmf), 0)::bigint AS total_kmf,
      COALESCE(SUM(r.amount_kmf) FILTER (WHERE r.refund_method = 'stripe'), 0)::bigint AS stripe_kmf,
      COALESCE(SUM(r.amount_kmf) FILTER (WHERE r.refund_method = 'store_credit'), 0)::bigint AS store_credit_kmf
    FROM refunds r
    JOIN orders o ON o.id = r.order_id
    WHERE r.status = 'completed'
      AND r.completed_at >= $1
      AND r.completed_at <= $2
      ${marketClause}
  `, params);

  const row = rows[0] || {};
  const count = Number(row.count) || 0;
  const total = Number(row.total_kmf) || 0;

  return {
    metric: makeKpi('remboursements', 'Remboursements', total, 'KMF', {
      itemsTotal: count,
      itemsWithData: count,
      warning: count > 0 ? `${count} remboursement(s) sur la période` : null,
    }),
    summary: Object.freeze({
      count,
      total_kmf: total,
      stripe_kmf: Number(row.stripe_kmf) || 0,
      store_credit_kmf: Number(row.store_credit_kmf) || 0,
    }),
  };
}

async function getPaymentMix(filters = {}) {
  const { where, params } = buildFiltersClause(filters, 'o');
  const { rows } = await db.query(`
    SELECT
      o.payment_mode::text AS payment_mode,
      COUNT(*)::int AS orders,
      COALESCE(SUM(o.total_kmf), 0)::bigint AS total_kmf
    FROM orders o
    WHERE ${where}
      AND o.payment_status = 'paid'
      AND o.status NOT IN ('cancelled', 'refunded')
    GROUP BY o.payment_mode
    ORDER BY total_kmf DESC, payment_mode ASC
  `, params);

  return rows.map(row => ({
    payment_mode: row.payment_mode || 'unknown',
    orders: Number(row.orders) || 0,
    total_kmf: Number(row.total_kmf) || 0,
  }));
}

async function getRecentRefunds(periodWindow, market = null) {
  const params = [periodWindow.from, periodWindow.to];
  let marketClause = '';
  if (market && market.id) {
    params.push(market.id);
    marketClause = `AND o.market_id = $${params.length}`;
  }

  const { rows } = await db.query(`
    SELECT
      o.reference AS order_reference,
      r.amount_kmf,
      r.refund_method,
      r.completed_at
    FROM refunds r
    JOIN orders o ON o.id = r.order_id
    WHERE r.status = 'completed'
      AND r.completed_at >= $1
      AND r.completed_at <= $2
      ${marketClause}
    ORDER BY r.completed_at DESC
    LIMIT 20
  `, params);

  return rows.map(row => ({
    order_reference: row.order_reference,
    amount_kmf: Number(row.amount_kmf) || 0,
    refund_method: row.refund_method || 'unknown',
    completed_at: row.completed_at,
  }));
}

function trendBucket(period) {
  if (period <= 7) return 'day';
  if (period <= 30) return 'week';
  return 'month';
}

async function getFinanceTrend(filters = {}, period = 30) {
  const bucket = trendBucket(period);
  const { where, params } = buildFiltersClause(filters, 'o');
  const expectedIndex = params.length + 1;
  const queryParams = [...params, EXPECTED_COST_TYPES];
  const expectedCount = EXPECTED_COST_TYPES.length;

  const { rows } = await db.query(`
    WITH scoped_orders AS (
      SELECT o.id, o.created_at, o.total_kmf
      FROM orders o
      WHERE ${where}
        AND o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled', 'refunded')
    ),
    cost_truth AS (
      SELECT
        so.*,
        COALESCE((
          SELECT SUM(alc.amount_kmf)
          FROM order_item_real_cost_allocations alc
          WHERE alc.order_id = so.id
            AND alc.is_actual = TRUE
        ), 0)::bigint AS real_cost_kmf,
        EXISTS (
          SELECT 1 FROM order_item_cost_imputations imp WHERE imp.order_id = so.id
        ) AS has_imputation,
        (
          SELECT COUNT(DISTINCT alc.cost_type::text)
          FROM order_item_real_cost_allocations alc
          WHERE alc.order_id = so.id
            AND alc.is_actual = TRUE
            AND alc.cost_type::text = ANY($${expectedIndex}::text[])
        )::int AS expected_cost_types
      FROM scoped_orders so
    )
    SELECT
      date_trunc('${bucket}', created_at) AS bucket,
      COUNT(*)::int AS paid_orders,
      COALESCE(SUM(total_kmf), 0)::bigint AS revenue_kmf,
      COALESCE(SUM(real_cost_kmf), 0)::bigint AS real_cost_kmf,
      COUNT(*) FILTER (
        WHERE has_imputation = TRUE AND expected_cost_types = ${expectedCount}
      )::int AS actual_orders,
      COALESCE(SUM(
        CASE
          WHEN has_imputation = TRUE AND expected_cost_types = ${expectedCount}
          THEN total_kmf - real_cost_kmf
          ELSE 0
        END
      ), 0)::bigint AS consolidated_margin_kmf
    FROM cost_truth
    GROUP BY date_trunc('${bucket}', created_at)
    ORDER BY bucket ASC
  `, queryParams);

  return rows.map(row => {
    const paidOrders = Number(row.paid_orders) || 0;
    const actualOrders = Number(row.actual_orders) || 0;
    return Object.freeze({
      bucket: row.bucket,
      paid_orders: paidOrders,
      revenue_kmf: Number(row.revenue_kmf) || 0,
      real_cost_kmf: Number(row.real_cost_kmf) || 0,
      consolidated_margin_kmf: Number(row.consolidated_margin_kmf) || 0,
      actual_orders: actualOrders,
      cost_coverage_pct: paidOrders > 0 ? Number(((actualOrders / paidOrders) * 100).toFixed(1)) : null,
    });
  });
}

async function getCostFamilyBreakdown(filters = {}) {
  const { where, params } = buildFiltersClause(filters, 'o');
  const { rows } = await db.query(`
    SELECT
      alc.cost_type::text AS cost_type,
      COUNT(DISTINCT o.id)::int AS orders,
      COALESCE(SUM(alc.amount_kmf), 0)::bigint AS amount_kmf
    FROM order_item_real_cost_allocations alc
    JOIN orders o ON o.id = alc.order_id
    WHERE ${where}
      AND o.status NOT IN ('cancelled', 'refunded')
      AND alc.is_actual = TRUE
    GROUP BY alc.cost_type::text
    ORDER BY amount_kmf DESC, cost_type ASC
  `, params);

  return rows.map(row => Object.freeze({
    cost_type: row.cost_type || 'unknown',
    orders: Number(row.orders) || 0,
    amount_kmf: Number(row.amount_kmf) || 0,
  }));
}

async function getRecentCostingOrders(filters = {}, options = {}) {
  const limit = Math.min(50, Math.max(1, Number(options.limit) || 20));
  const { where, params } = buildFiltersClause(filters, 'o');
  const expectedIndex = params.length + 1;
  const limitIndex = params.length + 2;
  const queryParams = [...params, EXPECTED_COST_TYPES, limit];
  const expectedCount = EXPECTED_COST_TYPES.length;

  const { rows } = await db.query(`
    SELECT
      o.reference,
      o.status,
      o.payment_status,
      o.total_kmf,
      o.created_at,
      (SELECT SUM(imp.estimated_business_complete_cost_kmf)
       FROM order_item_cost_imputations imp
       WHERE imp.order_id = o.id) AS estimated_cost_kmf,
      (SELECT SUM(alc.amount_kmf)
       FROM order_item_real_cost_allocations alc
       WHERE alc.order_id = o.id AND alc.is_actual = TRUE) AS real_cost_kmf,
      EXISTS (
        SELECT 1 FROM order_item_cost_imputations imp WHERE imp.order_id = o.id
      ) AS has_imputation,
      (SELECT COUNT(DISTINCT alc.cost_type::text)
       FROM order_item_real_cost_allocations alc
       WHERE alc.order_id = o.id
         AND alc.is_actual = TRUE
         AND alc.cost_type::text = ANY($${expectedIndex}::text[]))::int AS expected_cost_types
    FROM orders o
    WHERE ${where}
      AND o.status NOT IN ('cancelled', 'refunded')
    ORDER BY o.created_at DESC
    LIMIT $${limitIndex}
  `, queryParams);

  return rows.map(row => {
    const sale = Number(row.total_kmf) || 0;
    const estimated = row.estimated_cost_kmf == null ? null : Number(row.estimated_cost_kmf);
    const real = row.real_cost_kmf == null ? null : Number(row.real_cost_kmf);
    const expectedTypes = Number(row.expected_cost_types) || 0;
    const hasImputation = row.has_imputation === true || row.has_imputation === 'true';
    const costStatus = !hasImputation
      ? 'incomplete'
      : (expectedTypes === expectedCount ? 'actual' : (real != null ? 'partial_real' : 'estimated'));

    return Object.freeze({
      reference: row.reference,
      status: row.status,
      payment_status: row.payment_status,
      sale_total_kmf: sale,
      estimated_cost_kmf: estimated,
      real_cost_kmf: real,
      variance_kmf: estimated != null && real != null ? real - estimated : null,
      estimated_margin_kmf: estimated != null ? sale - estimated : null,
      consolidated_margin_kmf: costStatus === 'actual' && real != null ? sale - real : null,
      cost_status: costStatus,
      created_at: row.created_at,
    });
  });
}

async function buildFinance(query = {}, options = {}) {
  const market = options.market || null;
  const window = buildPeriod(query, market && market.id, options.now || new Date());

  const [
    ca,
    coutEstime,
    coutReel,
    margeEstimee,
    margeVariableReelle,
    marge,
    completudeCouts,
    coutIncomplet,
    paiementsAttente,
    refunds,
    paymentMix,
    recentRefunds,
    incompleteOrders,
    trend,
    costFamilies,
    costingOrders,
  ] = await Promise.all([
    metrics.getCAEncaisse(window.filters),
    metrics.getCoutEstime(window.filters),
    metrics.getCoutReel(window.filters),
    metrics.getMargeEstimee(window.filters),
    metrics.getMargeVariableReelle(window.filters),
    metrics.getMargeConsolidee(window.filters),
    metrics.getTauxCompletudeCouts(window.filters),
    metrics.getCmdsCoutIncompletCount(window.filters),
    metrics.getPaiementsEnAttente(window.filters),
    getRefunds(window, market),
    getPaymentMix(window.filters),
    getRecentRefunds(window, market),
    metrics.getCmdsCoutIncompletIds(window.filters, { limit: 20 }),
    getFinanceTrend(window.filters, window.period),
    getCostFamilyBreakdown(window.filters),
    getRecentCostingOrders(window.filters, { limit: 20 }),
  ]);

  return Object.freeze({
    scope: publicScope(market),
    period: window.period,
    kpis: Object.freeze([
      ca,
      coutReel,
      marge,
      completudeCouts,
      coutIncomplet,
      paiementsAttente,
      refunds.metric,
    ]),
    costing_kpis: Object.freeze([
      coutEstime,
      coutReel,
      margeEstimee,
      margeVariableReelle,
      marge,
    ]),
    trend: Object.freeze(trend),
    cost_families: Object.freeze(costFamilies),
    costing_orders: Object.freeze(costingOrders),
    payment_mix: Object.freeze(paymentMix),
    refunds: Object.freeze({
      ...refunds.summary,
      recent: Object.freeze(recentRefunds),
    }),
    incomplete_cost_orders: Object.freeze(incompleteOrders.map(row => Object.freeze({
      reference: row.reference,
      status: row.status,
      payment_status: row.payment_status,
      total_kmf: Number(row.total_kmf) || 0,
      created_at: row.created_at,
    }))),
    data_quality: Object.freeze({
      generated_at: new Date(options.now || Date.now()).toISOString(),
      scope_enforced: true,
      scope_mode: market ? 'market' : 'global',
      finance_period_basis: Object.freeze({
        orders: 'orders.created_at',
        refunds: 'refunds.completed_at',
      }),
      economic_global_engine_consumed: false,
      source_tables: Object.freeze([
        'orders',
        'refunds',
        'order_items',
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
  buildPeriod,
  publicScope,
  getRefunds,
  getPaymentMix,
  getRecentRefunds,
  trendBucket,
  getFinanceTrend,
  getCostFamilyBreakdown,
  getRecentCostingOrders,
  buildFinance,
};
