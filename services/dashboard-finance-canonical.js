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
 * @db-read       orders, refunds, order_item_cost_imputations, order_item_real_cost_allocations
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, server_market_scope_is_authority, finance_event_date_is_authoritative
 * @impact-areas  admin-dashboard, finance, economic-engine, market-authorization
 * @version       2026-08
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

async function buildFinance(query = {}, options = {}) {
  const market = options.market || null;
  const window = buildPeriod(query, market && market.id, options.now || new Date());

  const [
    ca,
    coutReel,
    marge,
    completudeCouts,
    coutIncomplet,
    paiementsAttente,
    refunds,
    paymentMix,
    recentRefunds,
    incompleteOrders,
  ] = await Promise.all([
    metrics.getCAEncaisse(window.filters),
    metrics.getCoutReel(window.filters),
    metrics.getMargeConsolidee(window.filters),
    metrics.getTauxCompletudeCouts(window.filters),
    metrics.getCmdsCoutIncompletCount(window.filters),
    metrics.getPaiementsEnAttente(window.filters),
    getRefunds(window, market),
    getPaymentMix(window.filters),
    getRecentRefunds(window, market),
    metrics.getCmdsCoutIncompletIds(window.filters, { limit: 20 }),
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
      source_tables: Object.freeze([
        'orders',
        'refunds',
        'order_item_cost_imputations',
        'order_item_real_cost_allocations',
      ]),
    }),
  });
}

module.exports = {
  ALLOWED_PERIODS,
  normalizePeriod,
  buildPeriod,
  publicScope,
  getRefunds,
  getPaymentMix,
  getRecentRefunds,
  buildFinance,
};
