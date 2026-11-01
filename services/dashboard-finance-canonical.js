/**
 * @komerce-arch
 * @role          canonical-finance-dashboard-service
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   high
 * @inputs        dashboard_period, server_resolved_market
 * @outputs       canonical_finance_projection
 * @depends       db, dashboard-metrics, dashboard-metrics/_helpers, supplier-payment-review, financial-journal-reporting
 * @used-by       routes/admin-dashboard-market.js
 * @db-read       orders, refunds, order_items, order_item_cost_imputations, order_item_real_cost_allocations, relais, markets, parcel_items, parcels, customs_shipments, customs_shipment_parcels, financial_movements
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, server_market_scope_is_authority, finance_event_date_is_authoritative
 * @impact-areas  admin-dashboard, finance, economic-engine, purchasing, market-authorization
 * @version       2026-10
 */

'use strict';

const db = require('../db');
const { isValidScope } = require('./simulation-scope-service');
const { resolveBusinessTimezone, civilDayPeriodBounds } = require('./market-business-day');

// L3 — vue d'un périmètre de recette : mêmes calculs, sélection explicite, libellé obligatoire.
const SIMULATION_VIEW = (query = {}) => (isValidScope(query.simulation_scope)
  ? Object.freeze({ scope: query.simulation_scope, label: `Périmètre de recette ${query.simulation_scope} : faits simulés, pas une activité réelle de l'entreprise.` })
  : null);
const {
  justifiedRealSql, finalMarginReadySql, missingTypesArraySql, contextColumnsSql, describeOrderCosts,
} = require('./cost-allocation/cost-expectation');
const { computeOrderCostVariance } = require('./cost-allocation/variance');
const metrics = require('./dashboard-metrics');
const { getSupplierPaymentReview } = require('./supplier-payment-review');
const journalReporting = require('./financial-journal-reporting');
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

// L3 : période = N jours civils incluant aujourd'hui, du minuit du marché (UTC en global), comme Commerce.
function buildPeriod(query = {}, marketId = null, now = new Date(), market = null) {
  const period = normalizePeriod(query.period);
  const { timezone, source } = resolveBusinessTimezone(market);
  const { from, to } = civilDayPeriodBounds(now, period, timezone);

  return Object.freeze({
    period,
    timezone,
    timezone_source: source,
    from: from.toISOString(),
    to: to.toISOString(),
    filters: Object.freeze({
      from: from.toISOString(),
      to: to.toISOString(),
      ...(marketId ? { market_id: marketId } : {}),
      ...(isValidScope(query.simulation_scope) ? { simulation_scope: query.simulation_scope } : {}),
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

async function getFinanceTrend(filters = {}, period = 30, timezone = 'UTC') {
  const bucket = trendBucket(period);
  const { where, params } = buildFiltersClause(filters, 'o');
  const queryParams = [...params, timezone];
  const tz = `$${queryParams.length}::text`;

  const { rows } = await db.query(`
    WITH scoped_orders AS (
      SELECT o.id, o.created_at, o.total_kmf, o.status, o.payment_mode, o.relais_id
      FROM orders o
      WHERE ${where}
        AND o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled', 'refunded')
    ),
    cost_truth AS (
      SELECT
        so.*,
        (
          SELECT SUM(alc.amount_kmf)
          FROM order_item_real_cost_allocations alc
          WHERE alc.order_id = so.id
            AND ${justifiedRealSql('alc')}
        )::bigint AS real_cost_kmf,
        EXISTS (
          SELECT 1 FROM order_item_cost_imputations imp WHERE imp.order_id = so.id
        ) AS has_imputation,
        ${finalMarginReadySql('so')} AS final_ready
      FROM scoped_orders so
    )
    SELECT
      (date_trunc('${bucket}', created_at AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) AS bucket,
      COUNT(*)::int AS paid_orders,
      COALESCE(SUM(total_kmf), 0)::bigint AS revenue_kmf,
      SUM(real_cost_kmf)::bigint AS real_cost_kmf,
      COUNT(*) FILTER (
        WHERE has_imputation = TRUE AND final_ready AND real_cost_kmf IS NOT NULL
      )::int AS actual_orders,
      SUM(total_kmf - real_cost_kmf) FILTER (
        WHERE has_imputation = TRUE AND final_ready AND real_cost_kmf IS NOT NULL
      )::bigint AS consolidated_margin_kmf
    FROM cost_truth
    GROUP BY date_trunc('${bucket}', created_at AT TIME ZONE ${tz})
    ORDER BY bucket ASC
  `, queryParams);

  return rows.map(row => {
    const paidOrders = Number(row.paid_orders) || 0;
    const actualOrders = Number(row.actual_orders) || 0;
    return Object.freeze({
      bucket: row.bucket,
      paid_orders: paidOrders,
      revenue_kmf: Number(row.revenue_kmf) || 0,
      real_cost_kmf: row.real_cost_kmf == null ? null : Number(row.real_cost_kmf),
      consolidated_margin_kmf: row.consolidated_margin_kmf == null ? null : Number(row.consolidated_margin_kmf),
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
      AND ${justifiedRealSql('alc')}
    GROUP BY alc.cost_type::text
    ORDER BY amount_kmf DESC, cost_type ASC
  `, params);

  return rows.map(row => Object.freeze({
    cost_type: row.cost_type || 'unknown',
    orders: Number(row.orders) || 0,
    amount_kmf: Number(row.amount_kmf) || 0,
  }));
}

// Colonnes de la projection coûts d'une commande : source unique pour la liste Finance et la section Coûts de Commande 360.
const COSTING_ORDER_COLUMNS = `
      o.id AS order_id,
      o.reference,
      o.status,
      o.payment_status,
      o.payment_mode::text AS payment_mode,
      o.total_kmf,
      o.created_at,
      (SELECT m.code FROM markets m WHERE m.id = o.market_id) AS market_code,
      ${contextColumnsSql('o')},
      (SELECT SUM(imp.estimated_business_complete_cost_kmf)
       FROM order_item_cost_imputations imp
       WHERE imp.order_id = o.id) AS estimated_cost_kmf,
      (SELECT SUM(alc.amount_kmf)
       FROM order_item_real_cost_allocations alc
       WHERE alc.order_id = o.id AND ${justifiedRealSql('alc')}) AS real_cost_kmf,
      EXISTS (
        SELECT 1 FROM order_item_cost_imputations imp WHERE imp.order_id = o.id
      ) AS has_imputation,
      ${finalMarginReadySql('o')} AS final_ready,
      ${missingTypesArraySql('o')} AS missing_cost_types`;

async function projectCostingOrder(row) {
  const sale = Number(row.total_kmf) || 0;
  const estimated = row.estimated_cost_kmf == null ? null : Number(row.estimated_cost_kmf);
  const real = row.real_cost_kmf == null ? null : Number(row.real_cost_kmf);
  const hasImputation = row.has_imputation === true || row.has_imputation === 'true';
  const costStatus = !hasImputation
    ? 'incomplete'
    : (row.final_ready === true ? 'actual' : (real != null ? 'partial_real' : 'estimated'));
  const missingTypes = Array.isArray(row.missing_cost_types) ? row.missing_cost_types : [];
  const explanation = describeOrderCosts({
    status: row.status,
    payment_mode: row.payment_mode,
    imported: row.ctx_imported,
    customs_event: row.ctx_customs_event,
    relay_beneficiary: row.ctx_relay_beneficiary,
    hub_route: row.ctx_hub_route,
    hub_route_unknown: row.ctx_hub_route_unknown,
    customs_unknown: row.ctx_customs_unknown,
    missing_cost_types: missingTypes,
  });
  const truth = await computeOrderCostVariance(row.order_id);

  return Object.freeze({
    order_id: row.order_id,
    reference: row.reference,
    market_code: row.market_code || null,
    status: row.status,
    payment_status: row.payment_status,
    sale_total_kmf: sale,
    estimated_cost_kmf: estimated,
    real_cost_kmf: real,
    // Conservé pour compatibilité : écart brut estimé complet vs réel total. Ne qualifie rien.
    variance_kmf: estimated != null && real != null ? real - estimated : null,
    estimated_margin_kmf: estimated != null ? sale - estimated : null,
    consolidated_margin_kmf: costStatus === 'actual' && real != null ? sale - real : null,
    cost_status: costStatus,
    missing_cost_types: missingTypes,
    created_at: row.created_at,
    variance: buildOrderVariance(truth, costStatus, explanation),
  });
}

async function getRecentCostingOrders(filters = {}, options = {}) {
  const limit = Math.min(50, Math.max(1, Number(options.limit) || 20));
  const { where, params } = buildFiltersClause(filters, 'o');
  const limitIndex = params.length + 1;
  const queryParams = [...params, limit];

  const { rows } = await db.query(`
    SELECT${COSTING_ORDER_COLUMNS}
    FROM orders o
    WHERE ${where}
      AND o.status NOT IN ('cancelled', 'refunded')
    ORDER BY o.created_at DESC
    LIMIT $${limitIndex}
  `, queryParams);

  return Promise.all(rows.map(projectCostingOrder));
}

// Section « Coûts & écarts » de Commande 360 : même projection que la liste Finance, pour une seule commande
// (lecture seule). null = commande annulée/remboursée ou introuvable : coûts non applicables, jamais 0.
async function getOrderCosting(orderId) {
  const { rows } = await db.query(`
    SELECT${COSTING_ORDER_COLUMNS}
    FROM orders o
    WHERE o.id = $1
      AND o.status NOT IN ('cancelled', 'refunded')
  `, [orderId]);
  return rows.length ? projectCostingOrder(rows[0]) : null;
}


// ── Écarts coûts prévus / constatés (RCT1-FIN-01) ──────────────────────
// Écart de coût = réel − estimé sur le périmètre canonique N1 + paiement (variance.js).
// Écart de marge variable = −écart de coût (même périmètre). Aucun seuil de gravité.
const COST_OWNER = Object.freeze({
  product_purchase: Object.freeze({ label: 'Achats', href: '/admin/workspaces/purchasing' }),
  sourcing: Object.freeze({ label: 'Achats', href: '/admin/workspaces/purchasing' }),
  packaging: Object.freeze({ label: 'Hub', href: '/admin/hub-live' }),
  hub: Object.freeze({ label: 'Hub', href: '/admin/hub-live' }),
  freight: Object.freeze({ label: 'Expéditions & Douane', href: '/admin/workspaces/shipping-customs' }),
  customs: Object.freeze({ label: 'Expéditions & Douane', href: '/admin/workspaces/shipping-customs' }),
  port_transitaire: Object.freeze({ label: 'Expéditions & Douane', href: '/admin/workspaces/shipping-customs' }),
  local_distribution: Object.freeze({ label: 'Logistique', href: '/admin/orders-logistics' }),
  relay: Object.freeze({ label: 'Relais', href: '/admin/relais-live' }),
  payment: Object.freeze({ label: 'Comptabilité', href: '/admin/workspaces/accounting' }),
});

function classifyOrderVariance(truth, costStatus) {
  const est = truth && truth.estimated;
  const real = truth && truth.real;
  if (!est || est.variable_total_kmf == null) return { class: 'not_comparable', reason: 'estimate_absent' };
  if (!real || Object.keys(real.by_cost_type || {}).length === 0) return { class: 'not_comparable', reason: 'no_real_cost' };
  if (!truth.variance) {
    const unknownTypes = (real.expected_unknown_cost_types || []);
    return { class: 'not_comparable', reason: unknownTypes.length ? 'expected_cost_unknown' : 'scope_not_comparable' };
  }
  const delta = Math.round(truth.variance.total_kmf);
  if (costStatus !== 'actual') return { class: 'provisional', reason: 'real_incomplete', cost_variance_kmf: delta };
  if (delta > 0) return { class: 'overrun', reason: null, cost_variance_kmf: delta, margin_variance_kmf: -delta };
  if (delta < 0) return { class: 'saving', reason: null, cost_variance_kmf: delta, margin_variance_kmf: -delta };
  return { class: 'none', reason: null, cost_variance_kmf: 0, margin_variance_kmf: 0 };
}

function buildVarianceComponents(truth, explanation) {
  const estByType = (truth && truth.estimated && truth.estimated.by_cost_type) || {};
  const realByType = (truth && truth.real && truth.real.variable_by_cost_type) || {};
  const missing = new Map(((explanation && explanation.missing) || []).map(item => [item.type, item]));
  const notYet = new Map(((explanation && explanation.not_yet_expected) || []).map(item => [item.type, item]));
  const notApplicable = new Map(((explanation && explanation.not_applicable) || []).map(item => [item.type, item]));
  const types = new Set([...Object.keys(estByType), ...Object.keys(realByType), ...missing.keys(), ...notYet.keys(), ...notApplicable.keys()]);
  const order = Object.keys(COST_OWNER);
  return [...types].filter(type => order.includes(type)).sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(type => {
    const estRaw = Number(estByType[type]);
    const estimated = Number.isFinite(estRaw) && estRaw > 0 ? Math.round(estRaw) : null;
    const realRaw = realByType[type];
    const real = realRaw == null ? null : Math.round(Number(realRaw));
    let state;
    let motif = null;
    if (real != null) state = real === 0 ? 'zero_confirmed' : 'confirmed';
    else if (missing.has(type)) { state = 'unknown'; motif = missing.get(type).note || null; }
    else if (notYet.has(type)) { state = 'expected'; motif = notYet.get(type).expected_when ? `Attendu à : ${notYet.get(type).expected_when}` : null; }
    else if (notApplicable.has(type)) { state = 'not_applicable'; motif = notApplicable.get(type).motif || null; }
    else { state = 'expected'; }
    return {
      type,
      label: (missing.get(type) || notYet.get(type) || notApplicable.get(type) || {}).label || type,
      state,
      estimated_kmf: estimated,
      real_kmf: real,
      delta_kmf: real != null && estimated != null ? real - estimated : null,
      motif,
      owner: COST_OWNER[type] || null,
    };
  });
}

function buildOrderVariance(truth, costStatus, explanation) {
  const verdict = classifyOrderVariance(truth, costStatus);
  return Object.freeze({
    ...verdict,
    estimated_variable_kmf: truth && truth.estimated ? truth.estimated.variable_total_kmf : null,
    real_variable_kmf: truth && truth.real ? truth.real.variable_total_kmf : null,
    scope: 'N1+paiement',
    components: Object.freeze(buildVarianceComponents(truth, explanation)),
    margin: explanation ? explanation.margin : null,
  });
}

function summarizeVariances(orders) {
  const classes = ['overrun', 'saving', 'provisional', 'not_comparable', 'none'];
  const summary = { orders_considered: orders.length, scope: 'N1+paiement' };
  for (const key of classes) summary[key] = { orders: 0, amount_kmf: 0 };
  for (const order of orders) {
    const v = order.variance;
    if (!v || !summary[v.class]) continue;
    summary[v.class].orders += 1;
    if (v.cost_variance_kmf != null) summary[v.class].amount_kmf += v.cost_variance_kmf;
  }
  summary.not_comparable.amount_kmf = null;
  summary.none.amount_kmf = 0;
  return Object.freeze(summary);
}

function buildFollowUp(row) {
  const exp = row.cost_explanation || {};
  const actions = new Map();
  for (const item of exp.missing || []) {
    const owner = COST_OWNER[item.type];
    actions.set(item.type, {
      type: item.type, label: item.label || item.type, state: 'unknown',
      reason: item.note || null, owner: owner || null,
    });
  }
  const pending = (exp.not_yet_expected || []).map(item => ({
    type: item.type, label: item.label || item.type, state: 'expected',
    reason: item.expected_when ? `Attendu à : ${item.expected_when}` : null, owner: COST_OWNER[item.type] || null,
  }));
  return { to_establish: [...actions.values()], not_yet_due: pending };
}

async function getMarginScope(filters = {}) {
  const { where, params } = buildFiltersClause(filters, 'o');
  const { rows } = await db.query(`
    SELECT o.reference, o.status, o.payment_mode::text AS payment_mode, o.total_kmf,
           ${contextColumnsSql('o')},
           ${missingTypesArraySql('o')} AS missing_cost_types,
           EXISTS (SELECT 1 FROM order_item_cost_imputations i WHERE i.order_id = o.id) AS has_imputation,
           ${finalMarginReadySql('o')} AS final_ready,
           (SELECT SUM(alc.amount_kmf) FROM order_item_real_cost_allocations alc
             WHERE alc.order_id = o.id AND ${justifiedRealSql('alc')}) AS real_cost_kmf
    FROM orders o
    WHERE ${where}
      AND o.payment_status = 'paid'
      AND o.status NOT IN ('cancelled', 'refunded')
    ORDER BY o.created_at ASC
  `, params);
  const REASONS = {
    estimate_absent: 'Estimation absente',
    not_final_stage: 'Commande pas encore remise au client',
    costs_missing: 'Coûts attendus manquants',
    customs_unknown: 'Douane encore inconnue',
  };
  const excluded = new Map();
  const eligible = [];
  const split = { final: { orders: 0, amount_kmf: 0 }, partial: { orders: 0, amount_kmf: 0 } };
  // Rapport marge/vente sur les seules commandes finalisées (même périmètre que la marge consolidée).
  let eligibleRevenue = 0;
  let eligibleMargin = 0;
  for (const row of rows) {
    const hasImp = row.has_imputation === true || row.has_imputation === 'true';
    const ok = hasImp && row.final_ready === true;
    const realCost = row.real_cost_kmf == null ? null : Number(row.real_cost_kmf);
    if (realCost != null) {
      const bucket = ok ? split.final : split.partial;
      bucket.orders += 1;
      bucket.amount_kmf += realCost;
    }
    if (ok) {
      eligible.push(row.reference);
      if (realCost != null) { eligibleRevenue += Number(row.total_kmf) || 0; eligibleMargin += (Number(row.total_kmf) || 0) - realCost; }
      continue;
    }
    const exp = describeOrderCosts({
      status: row.status, payment_mode: row.payment_mode, imported: row.ctx_imported, customs_event: row.ctx_customs_event,
      relay_beneficiary: row.ctx_relay_beneficiary, hub_route: row.ctx_hub_route, hub_route_unknown: row.ctx_hub_route_unknown,
      customs_unknown: row.ctx_customs_unknown, missing_cost_types: row.missing_cost_types || [],
    });
    const reason = !hasImp ? 'estimate_absent' : (exp.margin.reason || 'costs_missing');
    const entry = excluded.get(reason) || { reason, label: REASONS[reason] || reason, count: 0 };
    entry.count += 1;
    excluded.set(reason, entry);
  }
  return Object.freeze({
    paid_orders: rows.length,
    eligible_orders: eligible.length,
    eligible_references: Object.freeze(eligible.slice(0, 20)),
    eligible_revenue_kmf: eligibleRevenue,
    eligible_margin_pct: eligibleRevenue > 0 ? Math.round((eligibleMargin / eligibleRevenue) * 1000) / 10 : null,
    excluded: Object.freeze([...excluded.values()]),
    real_cost_split: Object.freeze({ final: Object.freeze(split.final), partial: Object.freeze(split.partial) }),
  });
}

async function getRelayProfitability(filters = {}) {
  const { where, params } = buildFiltersClause(filters, 'o');
  const queryParams = params;

  const { rows } = await db.query(`
    WITH scoped_orders AS (
      SELECT o.id, o.relais_id, o.total_kmf, o.status, o.payment_mode
      FROM orders o
      WHERE ${where}
        AND o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled', 'refunded')
        AND o.relais_id IS NOT NULL
    ),
    cost_truth AS (
      SELECT
        so.*,
        (SELECT SUM(imp.estimated_business_complete_cost_kmf)
         FROM order_item_cost_imputations imp
         WHERE imp.order_id = so.id) AS estimated_cost_kmf,
        (SELECT SUM(alc.amount_kmf)
         FROM order_item_real_cost_allocations alc
         WHERE alc.order_id = so.id
           AND ${justifiedRealSql('alc')}) AS real_cost_kmf,
        EXISTS (
          SELECT 1 FROM order_item_cost_imputations imp WHERE imp.order_id = so.id
        ) AS has_imputation,
        ${finalMarginReadySql('so')} AS final_ready
      FROM scoped_orders so
    )
    SELECT
      r.name AS relais_name,
      COUNT(*)::int AS orders,
      COALESCE(SUM(ct.total_kmf), 0)::bigint AS revenue_kmf,
      SUM(ct.estimated_cost_kmf)::bigint AS estimated_cost_kmf,
      COUNT(*) FILTER (
        WHERE ct.has_imputation = TRUE AND ct.final_ready
      )::int AS actual_orders,
      SUM(ct.total_kmf) FILTER (
        WHERE ct.has_imputation = TRUE AND ct.final_ready
      )::bigint AS actual_revenue_kmf,
      SUM(ct.real_cost_kmf) FILTER (
        WHERE ct.has_imputation = TRUE AND ct.final_ready
      )::bigint AS real_cost_kmf
    FROM cost_truth ct
    JOIN relais r ON r.id = ct.relais_id
    GROUP BY r.id, r.name
    ORDER BY revenue_kmf DESC, r.name ASC
  `, queryParams);

  return rows.map(row => {
    const orders = Number(row.orders) || 0;
    const actualOrders = Number(row.actual_orders) || 0;
    const revenue = Number(row.revenue_kmf) || 0;
    const estimatedCost = row.estimated_cost_kmf == null ? null : Number(row.estimated_cost_kmf);
    const actualRevenue = row.actual_revenue_kmf == null ? null : Number(row.actual_revenue_kmf);
    const realCost = row.real_cost_kmf == null ? null : Number(row.real_cost_kmf);

    return Object.freeze({
      relais_name: row.relais_name || 'Relais',
      orders,
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

// Projection du journal financier (Lot 5) : lecture seule, jamais bloquante pour le dashboard.
async function loadJournalProjection(window, market) {
  try {
    return Object.freeze(await journalReporting.projection(db, {
      marketId: market && market.id, from: window.from, to: window.to,
    }));
  } catch (_) {
    return null;
  }
}

async function buildFinance(query = {}, options = {}) {
  const market = options.market || null;
  const window = buildPeriod(query, market && market.id, options.now || new Date(), market);

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
    relayProfitability,
    supplierPaymentReview,
    marginScope,
    journal,
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
    getFinanceTrend(window.filters, window.period, window.timezone),
    getCostFamilyBreakdown(window.filters),
    getRecentCostingOrders(window.filters, { limit: 20 }),
    getRelayProfitability(window.filters),
    getSupplierPaymentReview({ limit: 50, ...(market && market.id ? { market_id: market.id } : {}) }),
    getMarginScope(window.filters),
    loadJournalProjection(window, market),
  ]);

  return Object.freeze({
    scope: publicScope(market),
    simulation: SIMULATION_VIEW(query),
    period: window.period,
    business_timezone: window.timezone,
    period_definition: Object.freeze({
      kind: 'civil_days_including_today',
      days: window.period,
      timezone: window.timezone,
      timezone_source: window.timezone_source,
      from: window.from,
      to: window.to,
    }),
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
    variance_summary: summarizeVariances(costingOrders),
    margin_scope: marginScope,
    journal,
    relay_profitability: Object.freeze(relayProfitability),
    payment_mix: Object.freeze(paymentMix),
    refunds: Object.freeze({
      ...refunds.summary,
      recent: Object.freeze(recentRefunds),
    }),
    // Total (non plafonné) de la même cohorte que la liste : commandes non annulées, payées ou non.
    incomplete_cost_orders_total: coutIncomplet && coutIncomplet.value != null ? Number(coutIncomplet.value) : null,
    incomplete_cost_orders: Object.freeze(incompleteOrders.map(row => Object.freeze({
      reference: row.reference,
      market_code: row.market_code || null,
      follow_up: buildFollowUp(row),
      status: row.status,
      payment_status: row.payment_status,
      total_kmf: Number(row.total_kmf) || 0,
      created_at: row.created_at,
      missing_cost_types: Object.freeze([...(row.missing_cost_types || [])]),
      cost_explanation: row.cost_explanation ? Object.freeze({ ...row.cost_explanation }) : null,
    }))),
    ...(supplierPaymentReview ? { supplier_payment_review: supplierPaymentReview } : {}),
    data_quality: Object.freeze({
      generated_at: new Date(options.now || Date.now()).toISOString(),
      business_timezone: window.timezone,
      business_timezone_source: window.timezone_source,
      scope_enforced: true,
      scope_mode: market ? 'market' : 'global',
      finance_period_basis: Object.freeze({
        orders: Object.freeze({
          field: 'orders.created_at',
          semantics: 'paid_order_creation_cohort',
          cash_basis: false,
          reason: 'no_universal_payment_received_timestamp_across_all_payment_modes',
        }),
        refunds: Object.freeze({
          field: 'refunds.completed_at',
          semantics: 'refund_completion_event',
        }),
      }),
      relay_real_margin_basis: 'actual_cost_orders_only',
      economic_global_engine_consumed: false,
      supplier_payment_review_basis: supplierPaymentReview ? supplierPaymentReview.basis : null,
      source_tables: Object.freeze([
        'orders',
        'refunds',
        'order_items',
        'order_item_cost_imputations',
        'order_item_real_cost_allocations',
        'relais',
        ...(supplierPaymentReview ? ['supplier_execution_payments'] : []),
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
  getOrderCosting,
  getRelayProfitability,
  getSupplierPaymentReview,
  classifyOrderVariance,
  buildVarianceComponents,
  summarizeVariances,
  buildFollowUp,
  getMarginScope,
  buildFinance,
};
