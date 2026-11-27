/**
 * @komerce-arch
 * @role          economic-engine-product-margin-steering
 * @domain        economic-engine
 * @layer         service
 * @criticality   medium
 * @inputs        request_or_service_payload
 * @outputs       response_or_domain_result
 * @depends       db, utils/rules.js, services/cost-allocation/cost-types.js, services/cost-allocation/_helpers.js, services/cost-allocation/real-margin-shadow.js, services/pricing-market-decision-policy.js
 * @used-by       routes/admin-costing.js
 * @db-read       orders, order_items, order_item_cost_imputations, order_item_real_cost_allocations, products, customs_categories, finance_config, customs_shipments, customs_shipment_parcels, parcel_items, business_rules, international_shipment_relay_receipts, international_shipments, international_n1_reconciliations, international_shipment_charges, product_skus, local_stock_economic_lots, local_stock_economic_lot_lines
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
const { justifiedRealSql, notLegacyUnjustifiedSql } = require('./cost-expectation');
const { getRuleNumber } = require('../../utils/rules');
const { SNAPSHOT_LANDED_TO_REAL_COST_TYPE } = require('./cost-types');
const { shareByWeight } = require('./_helpers');
const realMarginShadow = require('./real-margin-shadow');
const localStockLots = require('./local-stock-economic-lots');
const { getCurrentMarketDecisionPolicy } = require('../pricing-market-decision-policy');

const DEFAULT_RULES = Object.freeze({
  MARGIN_STEERING_GAP_ALERT_PTS: 5,
  MARGIN_STEERING_MIN_SALES: 3,
  MARGIN_STEERING_REPEAT_COUNT: 3,
  MARGIN_STEERING_CUSTOMS_IMPACT_PTS: 3,
});

const LANDED_VARIABLE_TYPES = new Set([...Object.values(SNAPSHOT_LANDED_TO_REAL_COST_TYPE), 'payment']);
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
    } else if (type !== 'product_purchase' && (r.actual_count > 0 || (LOGISTICS_REAL_TYPES.has(type) && r.actual > 0))) {
      costs[type] = { state: 'real', amount_kmf: r.actual };
    } else if (estimated > 0) {
      costs[type] = { state: 'estimated', amount_kmf: estimated };
      usedEstimate = true;
    }
  }
  const estPayment = qty * (num((bd.business || {}).payment) || 0);
  if (real.payment?.actual_count > 0) costs.payment = { state: 'real', amount_kmf: real.payment.actual };
  else if (estPayment > 0) { costs.payment = { state: 'estimated', amount_kmf: estPayment }; usedEstimate = true; }

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

// Materialize cost coverage from the same real evidence for display and decision.
function computeLandedCostEvidence({ result, real = {}, imported, localPurchase = null }) {
  const required = ['product_purchase', 'relay', 'payment'];
  if (imported) required.push('freight', 'customs', 'port_transitaire');
  const costs = { ...result.costs };
  if (!imported) {
    // The local lot is the sole source of acquisition; never use an import/catalogue estimate as actual.
    delete costs.product_purchase;
    for (const type of ['freight','port_transitaire']) if (costs[type]?.state === 'estimated') delete costs[type];
  }
  for (const [type, entry] of Object.entries(real)) {
    if (type === 'customs' || (!imported && type === 'product_purchase') || !LANDED_VARIABLE_TYPES.has(type)) continue;
    if (entry.actual_count > 0 && Number.isFinite(entry.actual)) {
      costs[type] = { state: 'real', amount_kmf: entry.actual };
    }
  }
  const purchaseConflict = imported && result.costs.product_purchase?.state === 'real' && real.product_purchase?.actual_count > 0
    && Math.round(result.costs.product_purchase.amount_kmf*100) !== Math.round(real.product_purchase.actual*100);
  const localConflict = !imported && localPurchase !== null && real.product_purchase?.actual_count > 0
    && Math.round(real.product_purchase.actual * 100) !== Math.round(localPurchase * 100);
  if (!imported && localPurchase !== null && Number.isFinite(localPurchase) && !localConflict) {
    costs.product_purchase = { state: 'real', amount_kmf: localPurchase };
  }
  const missing = required.filter(type => {
    const cost = costs[type];
    return !cost || cost.amount_kmf === null || (cost.state === 'not_expected' && type !== 'customs');
  });
  for (const type of missing) {
    if (!costs[type]) costs[type] = { state: 'missing', amount_kmf: null };
  }
  const reason = result.reason || (localConflict ? 'local_purchase_evidence_conflict' : null)
    || (purchaseConflict ? 'purchase_evidence_conflict' : null) || (missing.length ? 'cost_missing:' + missing[0] : null);
  const status = reason ? 'incomplete'
    : Object.values(costs).some(cost => cost.state === 'estimated') ? 'provisional' : 'final';
  return { status, reason, missing, costs };
}

// Never let an incomplete cost profile masquerade as a final margin.
// Keep independently reconciled revenue and margin as prerequisites: coverage
// does not certify payment, refund or order-level reconciliation by itself.
function applyLandedCostCoverage(line, real) {
  const result = line.result;
  const evidence = computeLandedCostEvidence({
    result, real, imported: line.fulfillment_source !== 'LOCAL_STOCK', localPurchase: line.local_purchase_kmf ?? null,
  });
  line.landed_cost_evidence = evidence;
  result.costs = evidence.costs;
  if (evidence.status === 'incomplete') {
    result.status = 'incomplete';
    result.reason = evidence.reason;
    result.cost_kmf = result.margin_kmf = result.margin_pct = null;
    delete result.reconciled_after_sale_margin_kmf;
    return;
  }
  const total = Object.values(evidence.costs).reduce((sum, cost) => sum + Math.round(cost.amount_kmf * 100), 0);
  const revenue = Math.round(result.sale_kmf * 100);
  const margin = (revenue - total) / 100;
  const reconciled = Number.isFinite(result.reconciled_after_sale_margin_kmf)
    && Math.round(result.reconciled_after_sale_margin_kmf * 100) === revenue - total;
  if (!reconciled || evidence.status !== 'final') delete result.reconciled_after_sale_margin_kmf;
  result.status = evidence.status === 'final' && result.status === 'final' && reconciled ? 'final' : 'provisional';
  result.cost_kmf = total / 100;
  result.margin_kmf = margin;
  result.margin_pct = result.sale_kmf > 0 ? pct2(100 * margin / result.sale_kmf) : null;
}

// A local or mixed order requires complete sale-line evidence and the canonical
// revenue/payment/refund oracle. The settled supplier purchase belongs only to IMPORT.
function reconcileLocalOrder(lines, shadow, orderItemCount) {
  if (!lines.length || lines.length !== orderItemCount || shadow?.status_order !== 'collected'
      || !Array.isArray(shadow.revenue?.flags)
      || shadow.revenue.flags.some(flag=>flag.startsWith('payment_status_') || flag.startsWith('refund_'))
      || lines.some(line=>(line.fulfillment_source === 'LOCAL_STOCK' ? !line.local_lot : line.fulfillment_source !== 'IMPORT') || line.landed_cost_evidence?.status !== 'final'
        || !Number.isFinite(line.result.cost_kmf) || !Number.isFinite(line.result.sale_kmf))) return false;
  const saleCents=lines.reduce((sum,line)=>sum+Math.round(line.result.sale_kmf*100),0);
  if (saleCents!==Math.round((shadow.revenue.net_kmf_exact ?? shadow.revenue.net_kmf)*100)) return false;
  const imported=lines.filter(line=>line.fulfillment_source==='IMPORT');
  if (imported.length) {
    const by=shadow.costs?.by_type;
    const purchase=by?.product_purchase;
    if (purchase?.state!=='real'||purchase.real_source!=='supplier_payment_settlements') return false;
    const cents=imported.reduce((sum,line)=>sum+Math.round(line.result.costs.product_purchase.amount_kmf*100),0);
    if(cents!==Math.round((purchase.real_kmf_exact??purchase.real_kmf)*100))return false;
    for(const type of LANDED_VARIABLE_TYPES) {
      if(type==='product_purchase')continue;
      const total=lines.reduce((sum,line)=>sum+Math.round((line.result.costs[type]?.amount_kmf||0)*100),0);
      const entry=by[type];
      if(entry?.state==='real'){
        if(total!==Math.round((entry.real_kmf_exact??entry.real_kmf)*100))return false;
      }else if(entry?.state!=='not_expected'||total!==0)return false;
    }
  }
  for (const { result } of lines) {
    result.status='final';
    result.reconciled_after_sale_margin_kmf=result.margin_kmf;
  }
  return true;
}

// Expand a fully attributed line into quantity-weighted observations. The
// purchase is exact per lot; other costs/revenue/estimate use largest remainder
// in cents. A partial or unproven line never produces an admissible fragment.
function expandLocalLotObservations(lines, shipments) {
  const expanded=[], lookup=new Map(shipments);
  for(const line of lines){
    const lot=shipments.get(line.order_item_id);
    if(line.fulfillment_source!=='LOCAL_STOCK'||!lot?.parts||lot.parts.length===1){expanded.push(line);continue;}
    const weights=lot.parts.map(p=>({id:p.shipment_id,weight:Number(p.part_quantity)}));
    const split=value=>new Map(shareByWeight(Math.round(value*100),weights).map(p=>[p.id,p.share]));
    const original=line.landed_cost_evidence;
    const final=original?.status==='final'&&Number.isFinite(line.result.reconciled_after_sale_margin_kmf);
    const sale=split(line.result.sale_kmf||0);
    const estimated=Number.isFinite(line.frozen_estimated_cost_kmf)?split(line.frozen_estimated_cost_kmf):null;
    const other=Object.entries(original?.costs||{}).filter(([type,c])=>type!=='product_purchase'&&c.state==='real');
    const allocated=other.map(([type,c])=>[type,split(c.amount_kmf)]);
    lookup.delete(line.order_item_id);
    for(const part of lot.parts){
      const id=line.order_item_id+':'+part.shipment_id;
      const costs={product_purchase:{state:'real',amount_kmf:Number(part.purchase_kmf)}};
      for(const [type,values] of allocated)costs[type]={state:'real',amount_kmf:values.get(part.shipment_id)/100};
      const rev=sale.get(part.shipment_id);
      const cost=Object.values(costs).reduce((sum,c)=>sum+Math.round(c.amount_kmf*100),0);
      expanded.push({...line,order_item_id:id,quantity:Number(part.part_quantity),
        frozen_estimated_cost_kmf:estimated?estimated.get(part.shipment_id)/100:null,
        landed_cost_evidence:{...original,status:final?'final':(original?.status||'incomplete'),costs},
        result:{...line.result,sale_kmf:rev/100,reconciled_after_sale_margin_kmf:final?(rev-cost)/100:null}});
      lookup.set(id,part);
    }
  }
  return {lines:expanded,shipments:lookup};
}

function summarizeObservedLandedCost(lines, shipments, { since, truncated }) {
  ({lines,shipments}=expandLocalLotObservations(lines,shipments));
  const cohorts = new Map();
  // A shipment counts once only if every line of that SKU in it is covered.
  // Never publish a partial shipment as an independent economic observation.
  const groups = new Map();
  const seen = new Set();
  for (const line of lines) {
    const shipment = shipments.get(line.order_item_id);
    const closed = Date.parse(shipment?.financial_closed_at);
    if (!shipment?.rail || !shipment.shipment_id || !line.sku_id || !Number.isFinite(closed) || closed < since || (line.fulfillment_source === 'LOCAL_STOCK' && shipment.rail !== 'LOCAL_STOCK')) continue;
    if (seen.has(line.order_item_id)) continue;
    seen.add(line.order_item_id);
    const observationKey = JSON.stringify([line.sku_id, shipment.rail, shipment.shipment_id]);
    const group = groups.get(observationKey) || [];
    group.push({ line, shipment });
    groups.set(observationKey, group);
  }
  for (const group of groups.values()) {
    const isFinal = ({ line }) => {
      const evidence = line.landed_cost_evidence;
      if (evidence?.status !== 'final' || !Number.isFinite(line.result.reconciled_after_sale_margin_kmf)
          || !Number.isFinite(line.result.sale_kmf) || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0) return false;
      const realCosts = Object.values(evidence.costs).filter(cost => cost.state === 'real');
      if (realCosts.some(cost => !Number.isFinite(cost.amount_kmf))) return false;
      const cents = realCosts.reduce((total, cost) => total + Math.round(cost.amount_kmf * 100), 0);
      return Math.round(line.result.sale_kmf * 100) - cents === Math.round(line.result.reconciled_after_sale_margin_kmf * 100);
    };
    const complete = group.every(entry => Number(entry.shipment.sku_line_count) === group.length && isFinal(entry));
    for (const { line, shipment } of group) {
      const key = JSON.stringify([line.sku_id, shipment.rail]);
      if (!cohorts.has(key)) cohorts.set(key, {
        sku_id: line.sku_id, sku_reference: line.sku_reference, rail: shipment.rail, shipments: new Set(), last_closed_at: null,
        quantity: 0, final_lines: 0, provisional_lines: 0, incomplete_lines: 0, costs: {},
        estimated_cents: 0, estimated_lines: 0,
      });
      const cohort = cohorts.get(key);
      const evidence = line.landed_cost_evidence;
      if (!complete) {
        cohort[evidence?.status === 'incomplete' || evidence?.status === 'final' ? 'incomplete_lines' : 'provisional_lines']++;
        continue;
      }
      cohort.shipments.add(shipment.shipment_id);
      const closedAt = new Date(shipment.financial_closed_at).toISOString();
      if (!cohort.last_closed_at || closedAt > cohort.last_closed_at) cohort.last_closed_at = closedAt;
      cohort.quantity += Number(line.quantity);
      cohort.final_lines++;
      if (Number.isFinite(line.frozen_estimated_cost_kmf)) {
        cohort.estimated_cents += Math.round(line.frozen_estimated_cost_kmf * 100);
        cohort.estimated_lines++;
      }
      for (const [type, cost] of Object.entries(evidence.costs)) {
        if (cost.state !== 'real') continue;
        cohort.costs[type] = (cohort.costs[type] || 0) + Math.round(cost.amount_kmf * 100);
      }
    }
  }
  // A local sale with no attested lot is visible as incomplete, not zero.
  for (const line of lines) {
    if (line.fulfillment_source !== 'LOCAL_STOCK' || !line.sku_id || shipments.has(line.order_item_id)
        || !(Date.parse(line.sold_at)>=since)) continue;
    const key=JSON.stringify([line.sku_id,'LOCAL_STOCK']);
    if (!cohorts.has(key)) cohorts.set(key,{sku_id:line.sku_id,sku_reference:line.sku_reference,rail:'LOCAL_STOCK',
      shipments:new Set(),last_closed_at:null,quantity:0,final_lines:0,provisional_lines:0,incomplete_lines:0,costs:{},estimated_cents:0,estimated_lines:0});
    cohorts.get(key).incomplete_lines++;
  }
  return [...cohorts.values()].map(({ shipments: observed, costs, estimated_cents, estimated_lines, ...cohort }) => {
    const total = Object.values(costs).reduce((sum, cents) => sum + cents, 0);
    const purchase = costs.product_purchase || 0;
    const status = truncated ? 'TRUNCATED'
      : observed.size < 3 ? 'INSUFFICIENT_OBSERVATIONS'
        : purchase <= 0 ? 'PURCHASE_COST_UNAVAILABLE' : 'DECISIONAL';
    return {
      ...cohort, status, observations: observed.size,
      unit_cost_kmf: cohort.quantity > 0 ? pct2(total / 100 / cohort.quantity) : null,
      estimated_unit_cost_kmf: estimated_lines === cohort.final_lines && cohort.quantity > 0
        ? pct2(estimated_cents / 100 / cohort.quantity) : null,
      // Compare only the frozen pre-sale estimates of the actual observed lines.
      // Do not divide by zero or substitute a current catalogue estimate.
      estimated_vs_real_pct: estimated_lines === cohort.final_lines && estimated_cents > 0 && cohort.quantity > 0
        ? pct2(100 * (total - estimated_cents) / estimated_cents) : null,
      observed_multiplier: purchase > 0 ? total / purchase : null,
      cost_by_type_kmf: Object.fromEntries(Object.entries(costs).map(([type, cents]) => [type, cents / 100])),
    };
  });
}

/** Remplace achat/paiement estimés par le réel de la commande (shadow final), au prorata. */
function applyFinalOrderReal(lines, shadow, orderItemCount) {
  // Order-level amounts can be shared only over the entire basket.
  if (shadow?.completeness !== 'final' || !lines.length || lines.length !== orderItemCount
      || lines.some((line) => line.result.status === 'incomplete')) return;

  const allocations = new Map();
  for (const type of ['product_purchase', 'payment']) {
    const entry = shadow.costs.by_type[type];
    if (!entry || entry.state !== 'real') continue;
    const weights = lines.map((line, id) => ({ id, weight: line.result.costs[type]?.amount_kmf ?? 0 }));
    const total = num(entry.real_kmf_exact ?? entry.real_kmf);
    if (total === null) return;
    if (type==='payment' && lines.some(line=>line.result.costs.payment?.state==='real')) {
      // A line-level actual PSP allocation is already authoritative. Do not
      // redistribute it using checkout estimates or count it a second time.
      if (lines.some(line=>line.result.costs.payment?.state!=='real')) return;
      const direct=lines.reduce((sum,line)=>sum+Math.round(line.result.costs.payment.amount_kmf*100),0);
      if (direct!==Math.round(total*100)) return;
      continue;
    }
    if (total !== 0 && !weights.some(({ weight }) => weight > 0)) return;
    allocations.set(type, shareByWeight(Math.round(total*100), weights).map(part=>({...part,share:part.share/100})));
  }

  for (const [type, parts] of allocations) {
    parts.forEach((p) => {
      const res = lines[p.id].result;
      if (res.costs[type] || (p.share===0 && type==='payment')) res.costs[type] = { state: 'real', amount_kmf: p.share };
    });
  }
  for (const l of lines) {
    const res = l.result;
    if (Object.values(res.costs).every((c) => c.state !== 'estimated')) {
      const cost = Object.values(res.costs).reduce((s, c) => s + Math.round((c.amount_kmf || 0)*100), 0);
      res.status = 'final';
      res.cost_kmf = cost/100;
      res.margin_kmf = (Math.round(res.sale_kmf*100)-cost)/100;
      res.margin_pct = res.sale_kmf > 0 ? pct2((res.margin_kmf / res.sale_kmf) * 100) : null;
    }
  }

  // The line sale total is frozen at checkout. Refunds and delivery can change
  // the order's net revenue without a corresponding line-level allocation.
  const revenue = shadow.revenue;
  if (shadow.status_order !== 'collected' || shadow.margin?.basis !== 'real_only'
      || !Array.isArray(revenue?.flags)
      || revenue.flags.some((flag) => flag.startsWith('payment_status_') || flag.startsWith('refund_'))
      || lines.some(({ result }) => result.status !== 'final')) return;
  const saleTotal = lines.reduce((sum, { result }) => sum + Math.round(result.sale_kmf*100), 0);
  const marginTotal = lines.reduce((sum, { result }) => sum + Math.round(result.margin_kmf*100), 0);
  if (saleTotal !== Math.round((revenue.net_kmf_exact ?? revenue.net_kmf)*100)
      || marginTotal !== Math.round((shadow.margin.shadow_kmf_exact ?? shadow.margin.shadow_kmf)*100)) return;

  for (const { result } of lines) result.reconciled_after_sale_margin_kmf = result.margin_kmf;
}

// Compare the same SKU and transport mode. Count each financially closed
// shipment once, only when the complete set of its SKU lines is reconciled.
function evaluateShipmentLosses(lines, selection, { since, truncated = false } = {}) {
  const threshold = selection?.loss_observation_count;
  const cohorts = new Map();
  if (!Number.isSafeInteger(threshold) || threshold < 1 || !Number.isFinite(since) || truncated) {
    return { status: 'INSUFFICIENT_EVIDENCE', comparable_cohorts: [] };
  }

  for (const line of lines) {
    const shipment = line.sale_shipment;
    if (!shipment || !line.sku_id || !(Date.parse(shipment.financial_closed_at) >= since)) continue;
    const key = JSON.stringify([line.sku_id, shipment.rail]);
    const cohort = cohorts.get(key) ?? new Map();
    cohorts.set(key, cohort);
    const entry = cohort.get(shipment.shipment_id) ?? { expected: shipment.sku_line_count, covered: new Set(), margin: 0, revenue: 0, purchase: 0, purchaseProven: true };
    cohort.set(shipment.shipment_id, entry);
    const margin = line.result.reconciled_after_sale_margin_kmf;
    if (Number.isFinite(margin) && !entry.covered.has(line.order_item_id)) {
      entry.covered.add(line.order_item_id);
      entry.margin += Math.round(margin * 100);
      const purchase = line.result.costs?.product_purchase;
      if (purchase?.state === 'real' && Number.isFinite(purchase.amount_kmf)
          && purchase.amount_kmf >= 0 && Number.isFinite(line.result.sale_kmf)) {
        entry.purchase += Math.round(purchase.amount_kmf * 100);
        entry.revenue += Math.round(line.result.sale_kmf * 100);
      } else {
        entry.purchaseProven = false;
      }
    }
  }

  const comparable_cohorts = [...cohorts].map(([key, shipments]) => {
    const [sku_id, rail] = JSON.parse(key);
    const complete = [...shipments].filter(([, entry]) => entry.covered.size === entry.expected);
    const losses = complete.filter(([, entry]) => entry.margin < 0).map(([id]) => id);
    const certain_loss_shipment_ids = complete
      .filter(([, entry]) => entry.margin < 0 && entry.purchaseProven && entry.purchase > entry.revenue)
      .map(([id]) => id);
    return { sku_id, rail, reconciled_shipment_count: complete.length, loss_shipment_ids: losses, certain_loss_shipment_ids };
  });
  const certain = comparable_cohorts.some(({ certain_loss_shipment_ids }) => certain_loss_shipment_ids.length);
  const reached = comparable_cohorts.some(({ loss_shipment_ids }) => loss_shipment_ids.length >= threshold);
  return {
    status: certain ? 'CERTAIN_LOSS_PROVEN' : reached ? 'WITHDRAWAL_THRESHOLD_REACHED' : comparable_cohorts.some((cohort) => cohort.reconciled_shipment_count)
      ? 'WITHDRAWAL_THRESHOLD_NOT_REACHED' : 'INSUFFICIENT_EVIDENCE',
    required_loss_observations: threshold,
    comparable_cohorts,
  };
}

async function loadComparableSaleShipments(marketId, lines, { includeIncomplete = false } = {}) {
  const ids = lines.filter(({ result }) => includeIncomplete || Number.isFinite(result.reconciled_after_sale_margin_kmf))
    .map(({ order_item_id }) => order_item_id);
  if (!ids.length) return new Map();
  const { rows } = await db.query(
    `SELECT r.order_item_id, r.shipment_id, s.transport_mode AS rail, n.financial_closed_at,
       (SELECT COUNT(*)::int
          FROM international_shipment_relay_receipts member
          JOIN order_items sibling ON sibling.id = member.order_item_id
         WHERE member.shipment_id = s.id AND sibling.sku_id = item.sku_id) AS sku_line_count
       FROM international_shipment_relay_receipts r
       JOIN order_items item ON item.id = r.order_item_id
       JOIN orders o ON o.id = item.order_id
       JOIN international_shipments s ON s.id = r.shipment_id
       JOIN international_n1_reconciliations n ON n.shipment_id = s.id
       LEFT JOIN customs_shipments cs ON cs.id = s.customs_shipment_id AND cs.market_id = s.market_id
      WHERE r.order_item_id = ANY($1::uuid[]) AND s.market_id = $2
        AND o.market_id = s.market_id AND o.simulation_scope IS NULL
        AND s.stage = 'relay_received' AND item.sku_id IS NOT NULL
        AND r.received_qty = item.quantity AND r.expected_qty = item.quantity
        AND n.financial_closed_at >= r.received_at AND n.financial_close_proof_ref IS NOT NULL
        AND n.freight_known IS TRUE AND n.reconciled_at >= GREATEST(s.updated_at, cs.declared_at)
        AND NOT EXISTS (
          SELECT 1 FROM international_shipment_charges charge
           WHERE charge.shipment_id = s.id AND charge.recorded_at > n.reconciled_at
        )
        AND NOT EXISTS (
          SELECT 1 FROM international_shipment_relay_receipts other
           WHERE other.order_item_id = r.order_item_id AND other.shipment_id <> r.shipment_id
        )`, [ids, marketId]
  );
  return new Map(rows.map((row) => [row.order_item_id, row]));
}

/** Agrégat produit + signal (fonction pure). `lines` triées de la plus récente à la plus ancienne. */
function summarizeProduct(lines, rules) {
  const orders = new Map();
  for (const { order_id, result } of lines) {
    if (!order_id) continue;
    const margin = result.reconciled_after_sale_margin_kmf;
    const previous = orders.get(order_id) ?? { margin: 0, complete: true };
    if (Number.isFinite(margin)) previous.margin += Math.round(margin * 100);
    else previous.complete = false;
    orders.set(order_id, previous);
  }
  const reconciledOrders = [...orders.values()].filter((order) => order.complete);
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
    after_sale_evidence: {
      reconciled_order_count: reconciledOrders.length,
      loss_order_count: reconciledOrders.filter(({ margin }) => margin < 0).length,
    },
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
async function listProductMarginSteering({ marketId, productId = null, sinceDays = 180, limit = 500, includeObservedCost = false } = {}) {
  if (!marketId) throw Object.assign(new Error('marketId requis'), { status: 400 });
  const days = Math.min(730, Math.max(1, parseInt(sinceDays, 10) || 180));
  const lim = Math.min(2000, Math.max(1, parseInt(limit, 10) || 500));
  const at = new Date();
  const [rules, policy] = await Promise.all([loadRules(), getCurrentMarketDecisionPolicy(marketId, { at })]);

  const [{ rows }, { rows: [fin] }] = await Promise.all([
    db.query(
      `SELECT oi.id AS order_item_id, oi.order_id, oi.product_id, oi.quantity, oi.sku_id, sku.sku AS sku_reference, imp.estimated_landed_relay_cost_kmf,
              oi.fulfillment_source,
              (SELECT COUNT(*)::int FROM order_items basket WHERE basket.order_id = oi.order_id) AS order_item_count,
              (oi.fulfillment_source IS DISTINCT FROM 'LOCAL_STOCK') AS customs_expected,
              EXISTS (
                SELECT 1 FROM parcel_items pi
                  JOIN customs_shipment_parcels csp ON csp.parcel_id = pi.parcel_id
                  JOIN customs_shipments cs ON cs.id = csp.shipment_id
                 WHERE pi.order_item_id = oi.id AND cs.is_active
                   AND cs.status <> 'pending' AND cs.customs_paid_kmf IS NOT NULL) AS customs_known,
              o.created_at AS sold_at, imp.sale_total_kmf, imp.cost_breakdown,
              p.name AS product_name, p.category AS product_family, p.target_margin_pct AS product_target_pct,
              cc.default_margin_pct AS category_target_pct
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         JOIN order_item_cost_imputations imp ON imp.order_item_id = oi.id
         LEFT JOIN product_skus sku ON sku.id = oi.sku_id
         LEFT JOIN products p ON p.id = oi.product_id
         LEFT JOIN customs_categories cc ON cc.key = p.category
        WHERE o.market_id = $1
          AND o.simulation_scope IS NULL
          AND o.status::text <> ALL($2::text[])
          AND o.created_at >= NOW() - ($3::int * INTERVAL '1 day')
          AND ($4::uuid IS NULL OR EXISTS (
            SELECT 1 FROM order_items selected
             WHERE selected.order_id = o.id AND selected.product_id = $4
          ))
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
              COALESCE(SUM(a.amount_kmf) FILTER (WHERE ${justifiedRealSql('a')} AND COALESCE(a.source,'') <> 'products.cost_kmf'), 0) AS actual,
              COUNT(*) FILTER (WHERE ${justifiedRealSql('a')} AND COALESCE(a.source,'') <> 'products.cost_kmf') AS actual_count,
              COALESCE(SUM(a.amount_kmf) FILTER (WHERE NOT a.is_actual AND ${notLegacyUnjustifiedSql('a')}), 0) AS non_actual
         FROM order_item_real_cost_allocations a
         LEFT JOIN customs_shipments cs ON cs.id = a.shipment_id
        WHERE a.order_item_id = ANY($1::uuid[])
        GROUP BY a.order_item_id, a.cost_type, a.shipment_id, cs.reference, cs.shipment_date, cs.status`,
      [itemIds]
    );
    for (const a of alloc) {
      const byType = realByItem.get(a.order_item_id) || {};
      const slot = byType[a.cost_type] || { actual: 0, non_actual: 0, actual_count: 0 };
      slot.actual_count += Number(a.actual_count || 0);
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
    if (result.status === 'final') result.status = 'provisional';
    return {
      order_item_count: r.order_item_count,
      order_item_id: r.order_item_id, order_id: r.order_id, product_id: r.product_id, product_name: r.product_name,
      product_target_pct: productTarget, sold_at: r.sold_at, quantity: r.quantity,
      sku_id: r.sku_id, sku_reference: r.sku_reference, product_family: r.product_family, fulfillment_source: r.fulfillment_source,
      target_pct: target, target_source: targetSource,
      shipments: [...(shipByItem.get(r.order_item_id) || new Map()).values()],
      frozen_estimated_cost_kmf: (() => {
        const landedTotal = num(r.estimated_landed_relay_cost_kmf);
        const payment = num(r.cost_breakdown?.business?.payment);
        return landedTotal === null || payment === null ? null : landedTotal + Number(r.quantity) * payment;
      })(),
      result,
    };
  });

  const localLots=await localStockLots.loadComparable(db,marketId,lines.filter(l=>l.fulfillment_source==='LOCAL_STOCK').map(l=>l.order_item_id));
  for (const line of lines) {
    const lot=localLots.get(line.order_item_id);
    if (lot) { line.local_lot=lot; line.local_purchase_kmf=num(lot.purchase_kmf); }
  }
  // Statut final : uniquement si la marge shadow de la commande est final.
  const byOrder = new Map();
  const localShadows=new Map();
  for (const l of lines) { if (l.result.status !== 'incomplete') (byOrder.get(l.order_id) || byOrder.set(l.order_id, []).get(l.order_id)).push(l); }
  for (const [orderId, orderLines] of byOrder) {
    const orderItemCount = orderLines[0].order_item_count;
    if (orderLines.length !== orderItemCount) continue;
    const shadow = await realMarginShadow.computeOrderRealMarginShadow(orderId, { marketId });
    if (orderLines.some(l=>l.fulfillment_source==='LOCAL_STOCK')) {
      localShadows.set(orderId,shadow);
      const imported=orderLines.filter(l=>l.fulfillment_source==='IMPORT');
      const purchase=shadow?.costs?.by_type?.product_purchase;
      if(imported.length&&purchase?.state==='real'&&purchase.real_source==='supplier_payment_settlements'){
        const amount=num(purchase.real_kmf_exact??purchase.real_kmf);
        const weights=imported.map((line,id)=>({id,weight:line.result.costs.product_purchase?.amount_kmf||0}));
        if(amount!==null&&(amount===0||weights.some(w=>w.weight>0))){
          for(const part of shareByWeight(Math.round(amount*100),weights)){
            imported[part.id].result.costs.product_purchase={state:'real',amount_kmf:part.share/100};
          }
        }
      }
    } else applyFinalOrderReal(orderLines, shadow, orderItemCount);
  }

  for (const l of lines) {
    applyLandedCostCoverage(l, realByItem.get(l.order_item_id));
  }
  for (const [orderId,shadow] of localShadows) {
    const orderLines=byOrder.get(orderId);
    reconcileLocalOrder(orderLines,shadow,orderLines[0].order_item_count);
  }
  for (const l of lines) l.result.gap_pts = l.result.margin_pct != null && l.target_pct != null ? pct2(l.result.margin_pct - l.target_pct) : null;

  const byProduct = new Map();
  for (const l of lines) {
    if (productId && l.product_id !== productId) continue;
    (byProduct.get(l.product_id) || byProduct.set(l.product_id, []).get(l.product_id)).push(l);
  }
  const selectionByFamily = policy?.selection_by_family;
  const truncated = rows.length === lim;
  const selectedLines = selectionByFamily && !truncated
    ? [...byProduct.values()].flat().filter(({ product_family }) => Object.hasOwn(selectionByFamily, product_family))
    : [];
  const shipments = await loadComparableSaleShipments(marketId, selectedLines);
  for (const line of selectedLines) line.sale_shipment = shipments.get(line.order_item_id);
  const observedSince = at.getTime() - 90 * 86400000;
  const observedShipments = includeObservedCost
    ? await loadComparableSaleShipments(marketId, [...byProduct.values()].flat(), { includeIncomplete: true })
    : new Map();
  if (includeObservedCost) for (const [id,lot] of localLots) observedShipments.set(id,lot);
  // Coverage is already applied to every line, including withdrawal readers.
  const since = Math.max(Date.parse(policy?.effective_from), at.getTime() - Number(policy?.window_days) * 86400000);

  const products = [...byProduct.entries()].map(([pid, pl]) => ({

    product_id: pid,
    product_name: pl[0].product_name,
    product_target_pct: pl[0].product_target_pct,
    ...summarizeProduct(pl, rules),
    ...(includeObservedCost ? { observed_landed_cost: summarizeObservedLandedCost(pl, observedShipments, { since: observedSince, truncated }) } : {}),
    after_sale_selection: {
      policy_version: policy?.version ?? null,
      ...evaluateShipmentLosses(pl, Object.hasOwn(selectionByFamily ?? {}, pl[0].product_family)
        ? selectionByFamily[pl[0].product_family] : null, { since, truncated }),
    },
    sales_detail: pl.map((l) => ({
      order_item_id: l.order_item_id, order_id: l.order_id, sold_at: l.sold_at, quantity: l.quantity,
      status: l.result.status, reason: l.result.reason, sale_kmf: l.result.sale_kmf, cost_kmf: l.result.cost_kmf,
      margin_kmf: l.result.margin_kmf, margin_pct: l.result.margin_pct, target_pct: l.target_pct,
      target_source: l.target_source, gap_pts: l.result.gap_pts, costs: l.result.costs,
      reconciled_after_sale_margin_kmf: l.result.reconciled_after_sale_margin_kmf ?? null,
      ...(includeObservedCost ? { landed_cost_evidence: l.landed_cost_evidence } : {}),
    })),
  })).sort((a, b) => (a.gap_pts ?? Infinity) - (b.gap_pts ?? Infinity));

  return {
    market_id: marketId,
    evaluated_at: at.toISOString(),
    since_days: days,
    ...(includeObservedCost ? { observed_landed_cost_window_days: 90 } : {}),
    rules,
    products,
    truncated,
  };
}

module.exports = { evaluateShipmentLosses, loadComparableSaleShipments, listProductMarginSteering, computeLineMargin, computeLandedCostEvidence, applyLandedCostCoverage, reconcileLocalOrder, expandLocalLotObservations, summarizeObservedLandedCost, summarizeProduct, applyFinalOrderReal, DEFAULT_RULES };
