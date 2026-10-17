/**
 * @komerce-arch
 * @role          economic-engine-product-margin-steering
 * @domain        economic-engine
 * @layer         service
 * @criticality   medium
 * @inputs        request_or_service_payload
 * @outputs       response_or_domain_result
 * @depends       db, utils/rules.js, services/cost-allocation/cost-types.js, services/cost-allocation/_helpers.js, services/cost-allocation/real-margin-shadow.js
 * @used-by       routes/admin-costing.js
 * @db-read       orders, order_items, order_item_cost_imputations, order_item_real_cost_allocations, products, customs_categories, finance_config, customs_shipments, customs_shipment_parcels, parcel_items, business_rules
 * @db-write      none
 * @db-txn        @none
 * @doctrine      pricing_market_viability_cost_scope
 * @impact-areas  economic-engine, admin-costing
 * @version       2026-10
 */

/**
 * KOMERCE — Pilotage par la marge, par produit (LECTURE SEULE)
 * ════════════════════════════════════════════════════════════
 *
 * Doctrine 2026-10 : le prix est une décision commerciale ; Komerce fixe une marge
 * cible par produit ; le moteur MESURE la marge réelle après imputation des coûts
 * effectivement connus et son écart à la cible. Aucune écriture, aucun prix modifié,
 * aucun blocage de sourcing : un signal et une proposition seulement.
 *
 * Par vente (ligne de commande) :
 *   - CA = sale_total_kmf figé au checkout ;
 *   - douane = allocations réelles d'expédition UNIQUEMENT (jamais l'estimé figé ni
 *     un taux de catégorie) ; ligne importée pas encore dans une expédition déclarée
 *     avec montant → INCONNUE (marge NULL, `incomplete`) ; stock local → non attendue ;
 *   - fret et frais transitaire = allocations réelles si présentes, sinon estimé figé ;
 *   - achat et autres coûts = estimé figé (unitaire × quantité). Statut `final`
 *     seulement si la marge shadow de la commande est `final` : achat/paiement réels
 *     de la commande ventilés au prorata des estimés (plus grand reste, conservé).
 *   - cible = marge cible figée dans le snapshot, sinon produit → catégorie → finance.
 * Écart en points = marge réelle % − cible %.
 */

'use strict';

const db = require('../../db');
const { getRuleNumber } = require('../../utils/rules');
const { SNAPSHOT_LANDED_TO_REAL_COST_TYPE } = require('./cost-types');
const { shareByWeight } = require('./_helpers');
const realMarginShadow = require('./real-margin-shadow');

const DEFAULT_RULES = Object.freeze({
  MARGIN_STEERING_GAP_ALERT_PTS: 5,
  MARGIN_STEERING_MIN_SALES: 3,
  MARGIN_STEERING_REPEAT_COUNT: 3,
  MARGIN_STEERING_CUSTOMS_IMPACT_PTS: 3,
});

const LOGISTICS_REAL_TYPES = new Set(['freight', 'port_transitaire']);
const NOT_SOLD_STATUSES = ['cancelled', 'refunded'];

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const pct2 = (v) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(2)));

async function loadRules() {
  const out = {};
  for (const [k, d] of Object.entries(DEFAULT_RULES)) out[k] = await getRuleNumber(k, d);
  return out;
}

/**
 * Coûts et marge d'une vente (fonction pure).
 * @param {object} line { quantity, sale_total_kmf, cost_breakdown, customs_expected, customs_known,
 *                        real: { [cost_type]: { actual, non_actual } }, target_pct }
 */
function computeLineMargin(line) {
  const qty = Number(line.quantity) || 0;
  const bd = line.cost_breakdown || {};
  const landed = bd.landed_relay || {};
  const sale = num(line.sale_total_kmf) || 0;
  const real = line.real || {};
  const costs = {};
  let usedEstimate = false;
  let incompleteReason = null;

  if (!line.cost_breakdown) incompleteReason = 'cost_snapshot_missing';

  for (const [snapKey, type] of Object.entries(SNAPSHOT_LANDED_TO_REAL_COST_TYPE)) {
    const estimated = qty * (num(landed[snapKey]) || 0);
    const r = real[type] || { actual: 0, non_actual: 0 };
    if (type === 'customs') {
      if (!line.customs_expected) {
        costs.customs = { state: 'not_expected', amount_kmf: 0 };
      } else if (!line.customs_known || (!(r.actual > 0) && r.non_actual > 0)) {
        costs.customs = { state: 'unknown', amount_kmf: null };
        incompleteReason = incompleteReason || 'customs_unknown';
      } else {
        costs.customs = { state: 'real', amount_kmf: r.actual };
      }
    } else if (LOGISTICS_REAL_TYPES.has(type) && r.actual > 0) {
      costs[type] = { state: 'real', amount_kmf: r.actual };
    } else if (estimated > 0) {
      costs[type] = { state: 'estimated', amount_kmf: estimated };
      usedEstimate = true;
    }
  }
  const estPayment = qty * (num((bd.business || {}).payment) || 0);
  if (estPayment > 0) { costs.payment = { state: 'estimated', amount_kmf: estPayment }; usedEstimate = true; }

  if (incompleteReason) {
    return { status: 'incomplete', reason: incompleteReason, sale_kmf: sale, costs, cost_kmf: null, margin_kmf: null, margin_pct: null };
  }
  const cost = Object.values(costs).reduce((s, c) => s + (c.amount_kmf || 0), 0);
  const margin = sale - cost;
  return {
    status: usedEstimate ? 'provisional' : 'final',
    reason: null,
    sale_kmf: sale,
    costs,
    cost_kmf: Math.round(cost * 100) / 100,
    margin_kmf: Math.round(margin * 100) / 100,
    margin_pct: sale > 0 ? pct2((margin / sale) * 100) : null,
  };
}

/** Remplace achat/paiement estimés par le réel de la commande (shadow final), au prorata. */
function applyFinalOrderReal(lines, shadow) {
  for (const type of ['product_purchase', 'payment']) {
    const entry = shadow.costs.by_type[type];
    if (!entry || entry.state !== 'real') continue;
    const parts = shareByWeight(entry.real_kmf, lines.map((l, i) => ({ id: i, weight: (l.result.costs[type] || {}).amount_kmf || 0 })));
    parts.forEach((p) => {
      const res = lines[p.id].result;
      if (res.costs[type]) res.costs[type] = { state: 'real', amount_kmf: p.share };
    });
  }
  for (const l of lines) {
    const res = l.result;
    if (Object.values(res.costs).every((c) => c.state !== 'estimated')) {
      const cost = Object.values(res.costs).reduce((s, c) => s + (c.amount_kmf || 0), 0);
      res.status = 'final';
      res.cost_kmf = cost;
      res.margin_kmf = res.sale_kmf - cost;
      res.margin_pct = res.sale_kmf > 0 ? pct2((res.margin_kmf / res.sale_kmf) * 100) : null;
    }
  }
}

/** Agrégat produit + signal (fonction pure). `lines` triées de la plus récente à la plus ancienne. */
function summarizeProduct(lines, rules) {
  const measured = lines.filter((l) => l.result.status !== 'incomplete');
  const sale = measured.reduce((s, l) => s + l.result.sale_kmf, 0);
  const cost = measured.reduce((s, l) => s + l.result.cost_kmf, 0);
  const targetWeighted = measured.filter((l) => l.target_pct != null);
  const targetSale = targetWeighted.reduce((s, l) => s + l.result.sale_kmf, 0);
  const cumTarget = targetSale > 0
    ? pct2(targetWeighted.reduce((s, l) => s + l.target_pct * l.result.sale_kmf, 0) / targetSale) : null;
  const cumMargin = sale > 0 ? pct2(((sale - cost) / sale) * 100) : null;
  const gap = cumMargin != null && cumTarget != null ? pct2(cumMargin - cumTarget) : null;

  const withCustoms = measured.filter((l) => l.result.costs.customs && l.result.costs.customs.state === 'real');
  const customsSale = withCustoms.reduce((s, l) => s + l.result.sale_kmf, 0);
  const customsKmf = withCustoms.reduce((s, l) => s + l.result.costs.customs.amount_kmf, 0);
  const customsImpact = customsSale > 0 ? pct2((customsKmf / customsSale) * 100) : null;

  const byShipment = new Map();
  for (const l of measured) {
    for (const s of l.shipments || []) {
      const e = byShipment.get(s.shipment_id) || {
        shipment_id: s.shipment_id, reference: s.reference, shipment_date: s.shipment_date, status: s.status,
        sales: 0, sale_kmf: 0, customs_kmf: 0, fees_kmf: 0,
      };
      e.sales += 1;
      e.sale_kmf += l.result.sale_kmf;
      e.customs_kmf += s.customs_kmf;
      e.fees_kmf += s.fees_kmf;
      byShipment.set(s.shipment_id, e);
    }
  }
  const by_shipment = [...byShipment.values()].map((e) => ({
    ...e,
    customs_impact_pts: e.sale_kmf > 0 ? pct2((e.customs_kmf / e.sale_kmf) * 100) : null,
    customs_and_fees_impact_pts: e.sale_kmf > 0 ? pct2(((e.customs_kmf + e.fees_kmf) / e.sale_kmf) * 100) : null,
  })).sort((a, b) => String(b.shipment_date || '').localeCompare(String(a.shipment_date || '')));

  const reasons = [];
  let signal = 'ok';
  const recent = measured.slice(0, rules.MARGIN_STEERING_REPEAT_COUNT);
  const repeated = recent.length >= rules.MARGIN_STEERING_REPEAT_COUNT
    && recent.every((l) => l.target_pct != null && l.result.margin_pct != null
      && l.result.margin_pct - l.target_pct <= -rules.MARGIN_STEERING_GAP_ALERT_PTS);
  if (measured.length < rules.MARGIN_STEERING_MIN_SALES) {
    signal = 'insufficient_data';
    reasons.push(`moins de ${rules.MARGIN_STEERING_MIN_SALES} ventes mesurées`);
  } else {
    if (gap != null && gap <= -rules.MARGIN_STEERING_GAP_ALERT_PTS) reasons.push(`marge cumulée ${gap} pts sous la cible`);
    if (repeated) reasons.push(`${rules.MARGIN_STEERING_REPEAT_COUNT} dernières ventes sous la cible de plus de ${rules.MARGIN_STEERING_GAP_ALERT_PTS} pts`);
    if (reasons.length) signal = 'review_suggested';
  }
  if (customsImpact != null && customsImpact >= rules.MARGIN_STEERING_CUSTOMS_IMPACT_PTS) {
    reasons.push(`douane ventilée = ${customsImpact} pts de marge`);
    if (signal === 'ok') signal = 'watch';
  }

  return {
    sales: lines.length,
    sales_measured: measured.length,
    sales_incomplete: lines.length - measured.length,
    sales_final: measured.filter((l) => l.result.status === 'final').length,
    target_margin_pct: cumTarget,
    cumulative_margin_pct: cumMargin,
    gap_pts: gap,
    sale_measured_kmf: sale,
    customs_impact_pts: customsImpact,
    by_shipment,
    signal,
    reasons,
    proposal: signal === 'review_suggested' ? 'Revoir le prix de vente ou la marge cible (aucun ajustement automatique).' : null,
  };
}

/**
 * @param {{marketId: string, productId?: string, sinceDays?: number, limit?: number}} opts
 */
async function listProductMarginSteering({ marketId, productId = null, sinceDays = 180, limit = 500 } = {}) {
  if (!marketId) throw Object.assign(new Error('marketId requis'), { status: 400 });
  const days = Math.min(730, Math.max(1, parseInt(sinceDays, 10) || 180));
  const lim = Math.min(2000, Math.max(1, parseInt(limit, 10) || 500));
  const rules = await loadRules();

  const [{ rows }, { rows: [fin] }] = await Promise.all([
    db.query(
      `SELECT oi.id AS order_item_id, oi.order_id, oi.product_id, oi.quantity,
              (oi.fulfillment_source IS DISTINCT FROM 'LOCAL_STOCK') AS customs_expected,
              EXISTS (
                SELECT 1 FROM parcel_items pi
                  JOIN customs_shipment_parcels csp ON csp.parcel_id = pi.parcel_id
                  JOIN customs_shipments cs ON cs.id = csp.shipment_id
                 WHERE pi.order_item_id = oi.id AND cs.is_active
                   AND cs.status <> 'pending' AND cs.customs_paid_kmf IS NOT NULL) AS customs_known,
              o.created_at AS sold_at, imp.sale_total_kmf, imp.cost_breakdown,
              p.name AS product_name, p.target_margin_pct AS product_target_pct,
              cc.default_margin_pct AS category_target_pct
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         JOIN order_item_cost_imputations imp ON imp.order_item_id = oi.id
         LEFT JOIN products p ON p.id = oi.product_id
         LEFT JOIN customs_categories cc ON cc.key = p.category
        WHERE o.market_id = $1
          AND o.status::text <> ALL($2::text[])
          AND o.created_at >= NOW() - ($3::int * INTERVAL '1 day')
          AND ($4::uuid IS NULL OR oi.product_id = $4)
        ORDER BY o.created_at DESC, oi.id
        LIMIT $5`,
      [marketId, NOT_SOLD_STATUSES, days, productId, lim]
    ),
    db.query('SELECT target_marge_brute_pct FROM finance_config WHERE id = 1'),
  ]);
  const financeTarget = num(fin && fin.target_marge_brute_pct);
  const itemIds = rows.map((r) => r.order_item_id);

  const realByItem = new Map();
  const shipByItem = new Map();
  if (itemIds.length) {
    const { rows: alloc } = await db.query(
      `SELECT a.order_item_id, a.cost_type, a.shipment_id, cs.reference, cs.shipment_date, cs.status,
              COALESCE(SUM(a.amount_kmf) FILTER (WHERE a.is_actual), 0) AS actual,
              COALESCE(SUM(a.amount_kmf) FILTER (WHERE NOT a.is_actual), 0) AS non_actual
         FROM order_item_real_cost_allocations a
         LEFT JOIN customs_shipments cs ON cs.id = a.shipment_id
        WHERE a.order_item_id = ANY($1::uuid[])
        GROUP BY a.order_item_id, a.cost_type, a.shipment_id, cs.reference, cs.shipment_date, cs.status`,
      [itemIds]
    );
    for (const a of alloc) {
      const byType = realByItem.get(a.order_item_id) || {};
      const slot = byType[a.cost_type] || { actual: 0, non_actual: 0 };
      slot.actual += Number(a.actual); slot.non_actual += Number(a.non_actual);
      byType[a.cost_type] = slot;
      realByItem.set(a.order_item_id, byType);
      if (a.shipment_id && (a.cost_type === 'customs' || a.cost_type === 'port_transitaire')) {
        const m = shipByItem.get(a.order_item_id) || new Map();
        const e = m.get(a.shipment_id) || {
          shipment_id: a.shipment_id, reference: a.reference, shipment_date: a.shipment_date, status: a.status, customs_kmf: 0, fees_kmf: 0,
        };
        if (a.cost_type === 'customs') e.customs_kmf += Number(a.actual); else e.fees_kmf += Number(a.actual);
        m.set(a.shipment_id, e);
        shipByItem.set(a.order_item_id, m);
      }
    }
  }

  const lines = rows.map((r) => {
    const frozen = num(r.cost_breakdown && r.cost_breakdown.target_margin_pct);
    const productTarget = num(r.product_target_pct);
    const categoryTarget = num(r.category_target_pct);
    let target = null; let targetSource = null;
    if (frozen != null) { target = frozen; targetSource = 'frozen_at_sale'; }
    else if (productTarget != null) { target = productTarget; targetSource = 'product_current'; }
    else if (categoryTarget != null) { target = categoryTarget; targetSource = 'category_current'; }
    else if (financeTarget != null) { target = financeTarget; targetSource = 'finance_current'; }
    const result = computeLineMargin({
      quantity: r.quantity, sale_total_kmf: r.sale_total_kmf, cost_breakdown: r.cost_breakdown,
      customs_expected: r.customs_expected, customs_known: r.customs_known,
      real: realByItem.get(r.order_item_id) || {},
    });
    return {
      order_item_id: r.order_item_id, order_id: r.order_id, product_id: r.product_id, product_name: r.product_name,
      product_target_pct: productTarget, sold_at: r.sold_at, quantity: r.quantity,
      target_pct: target, target_source: targetSource,
      shipments: [...(shipByItem.get(r.order_item_id) || new Map()).values()],
      result,
    };
  });

  // Statut final : uniquement si la marge shadow de la commande est final.
  const byOrder = new Map();
  for (const l of lines) { if (l.result.status !== 'incomplete') (byOrder.get(l.order_id) || byOrder.set(l.order_id, []).get(l.order_id)).push(l); }
  for (const [orderId, orderLines] of byOrder) {
    const shadow = await realMarginShadow.computeOrderRealMarginShadow(orderId, { marketId });
    if (shadow && shadow.completeness === 'final') applyFinalOrderReal(orderLines, shadow);
  }

  for (const l of lines) {
    l.result.gap_pts = l.result.margin_pct != null && l.target_pct != null ? pct2(l.result.margin_pct - l.target_pct) : null;
  }

  const byProduct = new Map();
  for (const l of lines) (byProduct.get(l.product_id) || byProduct.set(l.product_id, []).get(l.product_id)).push(l);
  const products = [...byProduct.entries()].map(([pid, pl]) => ({
    product_id: pid,
    product_name: pl[0].product_name,
    product_target_pct: pl[0].product_target_pct,
    ...summarizeProduct(pl, rules),
    sales_detail: pl.map((l) => ({
      order_item_id: l.order_item_id, order_id: l.order_id, sold_at: l.sold_at, quantity: l.quantity,
      status: l.result.status, reason: l.result.reason, sale_kmf: l.result.sale_kmf, cost_kmf: l.result.cost_kmf,
      margin_kmf: l.result.margin_kmf, margin_pct: l.result.margin_pct, target_pct: l.target_pct,
      target_source: l.target_source, gap_pts: l.result.gap_pts, costs: l.result.costs,
    })),
  })).sort((a, b) => (a.gap_pts ?? Infinity) - (b.gap_pts ?? Infinity));

  return {
    market_id: marketId,
    since_days: days,
    rules,
    products,
    truncated: rows.length === lim,
  };
}

module.exports = { listProductMarginSteering, computeLineMargin, summarizeProduct, applyFinalOrderReal, DEFAULT_RULES };
