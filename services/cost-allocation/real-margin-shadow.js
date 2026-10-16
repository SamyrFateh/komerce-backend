/**
 * @komerce-arch
 * @role          economic-engine-real-margin-shadow
 * @domain        economic-engine
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result
 * @depends       db, services/cost-allocation/cost-types.js, services/finance-metrics/customs-unknown.js
 * @used-by       routes/admin-costing.js
 * @db-read       orders, order_items, order_item_cost_imputations, order_item_real_cost_allocations, refunds, purchase_lines, purchase_orders, supplier_execution_payments, customs_shipments, customs_shipment_parcels, parcels
 * @db-write      (none)
 * @db-txn        @none
 * @doctrine      pricing_market_viability_cost_scope
 * @impact-areas  economic-engine, admin-costing
 * @version       2026-10
 */

/**
 * KOMERCE — Marge réelle canonique — SHADOW MODE (lecture seule)
 * ════════════════════════════════════════════════════════════════════════
 *
 * Calcule, sans rien écrire, ce que serait la marge réelle d'une commande
 * à partir des seules sources traçables, et la compare à la marge legacy
 * (orders.margin_real_pct = (total - cost_real_kmf)/total, trigger).
 *
 * Doctrine : une donnée non traçable n'est JAMAIS inventée. Un coût attendu
 * sans preuve réelle est « estimé figé » (provisional) ; un coût attendu
 * dont l'état est inconnu (douane pending / montant NULL, imputations
 * absentes) rend le résultat `incomplete` et la marge NULL.
 *
 * Achat : `products.cost_kmf` (allocate.js, is_actual=TRUE) est un coût
 * catalogue du jour, JAMAIS un achat réel. Un achat confirmé
 * (purchase_lines) n'est valorisable en KMF réel qu'avec le taux réellement
 * supporté, qui n'existe nulle part → `confirmed_unvalued`.
 *
 * Douane : uniquement depuis les allocations (jamais cost_douane_kmf, pour
 * éviter le double comptage avec recomputeCustomsCosts).
 *
 * Aucune alerte, aucun statut n'est écrit : margin_real_pct, margin_alert,
 * sourcing_blocked et cost_real_kmf ne sont que lus (bloc `legacy`).
 */

'use strict';

const db = require('../../db');
const { SNAPSHOT_LANDED_TO_REAL_COST_TYPE } = require('./cost-types');
const { customsUnknownSql } = require('../finance-metrics/customs-unknown');

const N1_TYPES = Object.values(SNAPSHOT_LANDED_TO_REAL_COST_TYPE);
const PAYMENT = 'payment';
const RISK = 'risk_provision';
const CATALOG_SOURCE = 'products.cost_kmf';
const ALERT_THRESHOLD_PCT = 10;
const NOT_APPLICABLE_STATUSES = new Set(['cancelled', 'refunded']);

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const kmf = (v) => (v == null ? null : Math.round(v));
const pct2 = (v) => (v == null ? null : Number(v.toFixed(2)));

async function _loadOrder(orderId) {
  const { rows } = await db.query(
    `SELECT o.id, o.market_id, o.status, o.payment_status, o.total_kmf, o.discount_kmf,
            o.wallet_applied_kmf, o.transport_price_kmf,
            o.cost_real_kmf, o.cost_transport_kmf, o.cost_douane_kmf,
            o.margin_real_pct, o.margin_alert, o.sourcing_blocked,
            ${customsUnknownSql('o')} AS customs_unknown
       FROM orders o WHERE o.id = $1`,
    [orderId]
  );
  return rows[0] || null;
}

async function _loadEstimated(orderId) {
  const landedCols = Object.keys(SNAPSHOT_LANDED_TO_REAL_COST_TYPE)
    .map((k) => `COALESCE(SUM((cost_breakdown->'landed_relay'->>'${k}')::numeric), 0) AS e_${k}`)
    .join(',\n       ');
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS imputations_count,
            COUNT(*) FILTER (WHERE cost_breakdown IS NULL)::int AS missing_snapshot_count,
            ${landedCols},
            COALESCE(SUM((cost_breakdown->'business'->>'payment')::numeric), 0) AS e_payment,
            COALESCE(SUM((cost_breakdown->'business'->>'risk_provision')::numeric), 0) AS e_risk
       FROM order_item_cost_imputations WHERE order_id = $1`,
    [orderId]
  );
  return rows[0];
}

async function _loadReal(orderId) {
  const { rows } = await db.query(
    `SELECT cost_type, source, allocation_method, is_actual, SUM(amount_kmf) AS amount
       FROM order_item_real_cost_allocations WHERE order_id = $1
      GROUP BY cost_type, source, allocation_method, is_actual`,
    [orderId]
  );
  return rows;
}

async function _loadRefundsKmf(orderId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(amount_kmf) FILTER (WHERE status = 'completed'), 0) AS done,
            COALESCE(SUM(amount_kmf) FILTER (WHERE status <> 'completed'), 0) AS pending
       FROM refunds WHERE order_id = $1`,
    [orderId]
  );
  return rows[0];
}

async function _loadPurchase(orderId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS lines,
            COALESCE(SUM(pl.confirmed_quantity), 0)::int AS quantity,
            SUM(pl.confirmed_quantity * pl.confirmed_unit_price) AS amount,
            COUNT(DISTINCT pl.supplier_currency)::int AS currencies,
            MIN(pl.supplier_currency) AS currency
       FROM purchase_lines pl JOIN order_items oi ON oi.id = pl.order_item_id
      WHERE oi.order_id = $1 AND pl.cancelled_at IS NULL
        AND pl.confirmed_at IS NOT NULL AND pl.confirmed_unit_price IS NOT NULL
        AND COALESCE(pl.confirmed_quantity, 0) > 0`,
    [orderId]
  );
  const { rows: pay } = await db.query(
    `SELECT COUNT(DISTINCT sep.id)::int AS payments,
            COUNT(DISTINCT sep.id) FILTER (WHERE sep.real_debit_verified)::int AS verified
       FROM supplier_execution_payments sep
       JOIN purchase_lines pl ON pl.purchase_order_id = sep.purchase_order_id AND pl.cancelled_at IS NULL
       JOIN order_items oi ON oi.id = pl.order_item_id
      WHERE oi.order_id = $1`,
    [orderId]
  );
  return { lines: rows[0], pay: pay[0] };
}

/**
 * Classe une allocation réelle : traçable ('real'), catalogue, ou non actuelle.
 * Seules les lignes is_actual et non catalogue sont réelles.
 */
function _splitReal(rows) {
  const byType = {};
  const catalog = { amount: 0 };
  const ignored = [];
  for (const r of rows) {
    const amount = num(r.amount) || 0;
    const t = r.cost_type;
    const slot = (byType[t] = byType[t] || { real: 0, sources: new Set(), fallback: 0 });
    if (t === 'product_purchase' && r.source === CATALOG_SOURCE) { catalog.amount += amount; continue; }
    if (!r.is_actual) { slot.fallback += amount; continue; }
    slot.real += amount;
    // estimated_fallback = montant issu d'une expédition DÉCLARÉE (traçable) mais
    // répartition entre colis/articles approximative : réel, confiance basse.
    slot.sources.add((r.source || 'unknown') + (r.allocation_method === 'estimated_fallback' ? ':low_confidence_split' : ''));
  }
  for (const t of Object.keys(byType)) {
    if (![...N1_TYPES, PAYMENT, RISK].includes(t)) ignored.push(t);
  }
  return { byType, catalog, ignored };
}

function _revenue(o, refunds) {
  const flags = [];
  const total = num(o.total_kmf) || 0;
  const discounts = num(o.discount_kmf) || 0;
  const wallet = num(o.wallet_applied_kmf) || 0;
  const delivery = num(o.transport_price_kmf) || 0;
  // total_kmf est déjà net de remise ET de crédit wallet (order-checkout-service) :
  // le crédit wallet est un moyen de paiement, il reste du revenu acquis.
  const gross = total + discounts + wallet;
  const refundsDone = num(refunds.done) || 0;
  if (wallet > 0) flags.push('wallet_credit_counted_as_revenue');
  if (delivery > 0) flags.push('delivery_included_in_total_as_komerce_transport_price');
  if (num(refunds.pending) > 0) flags.push('refund_not_completed_not_deducted');
  if (refundsDone > 0) flags.push('refund_components_unknown_delivery_vs_goods');
  if (o.payment_status !== 'paid') flags.push(`payment_status_${o.payment_status}`);
  return {
    gross_kmf: kmf(gross),
    discounts_kmf: kmf(discounts),
    refunds_kmf: kmf(refundsDone),
    delivery_kmf: kmf(delivery),
    // transport_price_kmf = prix commercial du transport facturé par Komerce
    // (le coût 'freight' correspondant est un coût N1) → revenu Komerce identifiable.
    delivery_counted: delivery > 0,
    net_kmf: kmf(gross - discounts - refundsDone),
    flags,
  };
}

function _classifyTypes({ est, realSplit, customsUnknown, purchaseInfo }) {
  const by = {};
  const unknown = [];
  const unvalued = [];
  const types = [...N1_TYPES, PAYMENT];
  for (const t of types) {
    const snapKey = Object.keys(SNAPSHOT_LANDED_TO_REAL_COST_TYPE).find((k) => SNAPSHOT_LANDED_TO_REAL_COST_TYPE[k] === t);
    const estimated = t === PAYMENT ? num(est.e_payment) || 0 : num(est[`e_${snapKey}`]) || 0;
    const slot = realSplit.byType[t];
    const entry = { estimated_kmf: kmf(estimated), real_kmf: null, real_source: null, state: 'not_expected' };
    if (t === 'product_purchase') {
      if (purchaseInfo.confirmedLines > 0 && estimated > 0) {
        entry.state = 'confirmed_unvalued'; // prix confirmé, taux supporté absent
        unvalued.push(t);
      } else if (estimated > 0 || realSplit.catalog.amount > 0) {
        entry.state = 'estimated_only';
        entry.real_source = realSplit.catalog.amount > 0 ? 'catalog_estimate:products.cost_kmf' : null;
      }
    } else if (t === 'customs' && customsUnknown) {
      entry.state = 'unknown';
      unknown.push(t);
    } else if (slot && slot.real > 0) {
      entry.state = 'real';
      entry.real_kmf = kmf(slot.real);
      entry.real_source = [...slot.sources].join(',');
    } else if (estimated > 0) {
      entry.state = 'estimated_only';
      if (slot && slot.fallback > 0) entry.real_source = 'non_actual_allocation_not_counted';
    }
    by[t] = entry;
  }
  by[RISK] = { estimated_kmf: kmf(num(est.e_risk) || 0), real_kmf: null, real_source: null, state: 'not_expected' };
  return { by, unknown, unvalued };
}

function _margin(revenueNet, by, completeness) {
  if (completeness === 'incomplete' || completeness === 'not_applicable') {
    return { shadow_kmf: null, shadow_pct: null, basis: null, contribution: null };
  }
  let n1 = 0;
  let all = 0;
  let usedEstimate = false;
  for (const [t, e] of Object.entries(by)) {
    if (t === RISK || e.state === 'not_expected') continue;
    const useReal = e.state === 'real';
    const v = useReal ? e.real_kmf : e.estimated_kmf;
    if (!useReal) usedEstimate = true;
    all += v;
    if (t !== PAYMENT) n1 += v;
  }
  const m = revenueNet - all;
  return {
    shadow_kmf: kmf(m),
    shadow_pct: revenueNet > 0 ? pct2((m / revenueNet) * 100) : null,
    basis: usedEstimate ? 'real_plus_estimated' : 'real_only',
    contribution: kmf(revenueNet - n1),
  };
}

/**
 * @param {string} orderId
 * @param {{marketId?: string}} [opts] marketId de confiance (serveur) : isole par marché
 * @returns {Promise<object|null>} null si la commande n'existe pas (ou hors marché)
 */
async function computeOrderRealMarginShadow(orderId, opts = {}) {
  const o = await _loadOrder(orderId);
  if (!o) return null;
  if (opts.marketId && o.market_id !== opts.marketId) return null;

  const [est, realRows, refunds, purchase] = await Promise.all([
    _loadEstimated(orderId), _loadReal(orderId), _loadRefundsKmf(orderId), _loadPurchase(orderId),
  ]);

  const revenue = _revenue(o, refunds);
  const realSplit = _splitReal(realRows);
  const confirmedLines = purchase.lines.lines;
  const { by, unknown, unvalued } = _classifyTypes({
    est, realSplit, customsUnknown: o.customs_unknown === true,
    purchaseInfo: { confirmedLines },
  });
  if (realSplit.ignored.length) revenue.flags.push(`real_cost_types_ignored:${realSplit.ignored.join('|')}`);

  const noImputations = !est.imputations_count || est.missing_snapshot_count > 0;
  if (noImputations) revenue.flags.push('cost_imputations_missing_or_partial');

  let completeness;
  if (NOT_APPLICABLE_STATUSES.has(o.status)) completeness = 'not_applicable';
  else if (noImputations || unknown.length > 0) completeness = 'incomplete';
  else if (Object.values(by).every((e) => e.state === 'real' || e.state === 'not_expected')) completeness = 'final';
  else completeness = 'provisional';

  const unknownTypes = noImputations ? ['all_imputations'] : unknown;
  const margin = _margin(revenue.net_kmf, by, completeness);

  // Prévisionnel : même CA net, coûts estimés figés (hors provision risque, période).
  const estTotal = Object.entries(by).filter(([t]) => t !== RISK).reduce((s, [, e]) => s + (e.estimated_kmf || 0), 0);
  const forecastPct = !noImputations && revenue.net_kmf > 0
    ? pct2(((revenue.net_kmf - estTotal) / revenue.net_kmf) * 100) : null;
  const realTotal = Object.values(by).reduce((s, e) => s + (e.real_kmf || 0), 0);

  const legacyPct = num(o.margin_real_pct);
  const delta = margin.shadow_pct != null && legacyPct != null ? pct2(margin.shadow_pct - legacyPct) : null;

  let purchaseState = by.product_purchase.state;
  const pl = purchase.lines;
  return {
    order_id: o.id,
    market_id: o.market_id,
    status_order: o.status,
    revenue,
    costs: {
      by_type: by,
      real_total_kmf: kmf(realTotal),
      estimated_total_kmf: kmf(estTotal),
      unknown_types: unknownTypes,
      unvalued_types: unvalued,
    },
    purchase: {
      estimated_kmf: by.product_purchase.estimated_kmf,
      catalog_estimate_kmf: kmf(realSplit.catalog.amount),
      confirmed: {
        lines: pl.lines,
        quantity: pl.quantity,
        amount: pl.currencies > 1 ? null : num(pl.amount),
        currency: pl.currencies > 1 ? 'MIXED' : pl.currency,
      },
      fx_borne: null, // aucun taux réellement supporté n'est tracé (cf. PR)
      supplier_payments: { count: purchase.pay.payments, debit_verified: purchase.pay.verified },
      state: purchaseState,
    },
    completeness,
    margin: { shadow_kmf: margin.shadow_kmf, shadow_pct: margin.shadow_pct, forecast_pct: forecastPct, basis: margin.basis },
    contribution_after_logistics_kmf: margin.contribution,
    legacy: {
      margin_real_pct: legacyPct,
      cost_real_kmf: num(o.cost_real_kmf),
      cost_transport_kmf: num(o.cost_transport_kmf),
      cost_douane_kmf: num(o.cost_douane_kmf),
      margin_alert: o.margin_alert,
      sourcing_blocked: o.sourcing_blocked,
    },
    delta_pct_points: delta,
    alerts: {
      forecast_margin_lt_10: forecastPct == null ? null : forecastPct < ALERT_THRESHOLD_PCT,
      real_margin_lt_10: margin.shadow_pct == null ? null : margin.shadow_pct < ALERT_THRESHOLD_PCT,
    },
  };
}

/**
 * Liste résumée par marché. marketId OBLIGATOIRE (résolu côté serveur).
 * L'agrégat porte sur la page retournée.
 */
async function listRealMarginShadow({ marketId, limit = 50, offset = 0, sinceDays = 90 } = {}) {
  if (!marketId) throw new Error('listRealMarginShadow: marketId requis');
  const lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const off = Math.max(0, parseInt(offset, 10) || 0);
  const days = Math.min(3650, Math.max(1, parseInt(sinceDays, 10) || 90));
  const { rows: ids } = await db.query(
    `SELECT id FROM orders
      WHERE market_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2
      ORDER BY created_at DESC, id LIMIT $3 OFFSET $4`,
    [marketId, days, lim, off]
  );
  const items = [];
  for (const { id } of ids) {
    const r = await computeOrderRealMarginShadow(id, { marketId });
    if (!r) continue;
    items.push({
      order_id: r.order_id, status_order: r.status_order, completeness: r.completeness,
      net_kmf: r.revenue.net_kmf, shadow_pct: r.margin.shadow_pct, forecast_pct: r.margin.forecast_pct,
      basis: r.margin.basis, legacy_margin_real_pct: r.legacy.margin_real_pct,
      delta_pct_points: r.delta_pct_points, unknown_types: r.costs.unknown_types,
      unvalued_types: r.costs.unvalued_types, alerts: r.alerts,
    });
  }
  const by_completeness = {};
  let dSum = 0; let dN = 0; let legacyN = 0;
  for (const it of items) {
    by_completeness[it.completeness] = (by_completeness[it.completeness] || 0) + 1;
    if (it.legacy_margin_real_pct != null) legacyN += 1;
    if (it.delta_pct_points != null) { dSum += it.delta_pct_points; dN += 1; }
  }
  return {
    market_id: marketId, limit: lim, offset: off, since_days: days, items,
    aggregate: {
      scope: 'page',
      by_completeness,
      avg_delta_pct_points: dN ? pct2(dSum / dN) : null,
      orders_with_legacy_margin: legacyN,
    },
  };
}

module.exports = { computeOrderRealMarginShadow, listRealMarginShadow };
