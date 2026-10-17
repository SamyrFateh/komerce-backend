/**
 * @komerce-arch
 * @role          economic-engine-real-margin-shadow
 * @domain        economic-engine
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result
 * @depends       db, services/cost-allocation/cost-types.js, services/cost-allocation/_helpers.js, services/finance-metrics/customs-unknown.js
 * @used-by       routes/admin-costing.js
 * @db-read       orders, order_items, order_item_cost_imputations, order_item_real_cost_allocations, refunds, purchase_lines, purchase_orders, supplier_execution_payments, supplier_payment_settlements, customs_shipments, customs_shipment_parcels, parcels
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
 * (purchase_lines) n'est valorisable en KMF réel que par les KMF réellement
 * débités (supplier_payment_settlements, migration 294, saisis avec preuve) ;
 * sans cela → `confirmed_unvalued`. Le taux effectif est CALCULÉ
 * (Σ KMF / Σ devise), jamais un taux de référence.
 *   - Réel seulement si : toutes les lignes actives de la commande confirmées ;
 *     tous les paiements de la/des PO succeeded + real_debit_verified + matched ;
 *     devise réglée = devise des lignes ; Σ réglé net des remboursements de
 *     marchandises = valeur confirmée de la PO (au centime de devise). Sinon
 *     provisoire (flags underpaid/overpaid/…).
 *   - PO regroupée : ventilation au prorata de la valeur confirmée des lignes,
 *     plus grand reste en centimes (conservation exacte).
 *   - Frais de paiement/conversion : coût `payment` réel (net des remboursements
 *     de frais) qui REMPLACE l'estimé du même type (jamais additionné).
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
const { customsExpectedSql, customsUnknownForLinesSql } = require('../finance-metrics/customs-unknown');
const { shareByWeight } = require('./_helpers');

const N1_TYPES = Object.values(SNAPSHOT_LANDED_TO_REAL_COST_TYPE);
const PAYMENT = 'payment';
const RISK = 'risk_provision';
const CATALOG_SOURCE = 'products.cost_kmf';
const ALERT_THRESHOLD_PCT = 10;
const NOT_APPLICABLE_STATUSES = new Set(['cancelled', 'refunded']);

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const kmf = (v) => (v == null ? null : Math.round(v));
const pct2 = (v) => (v == null ? null : Number(v.toFixed(2)));

async function _loadOrder(orderId, q = db) {
  const { rows } = await q.query(
    `SELECT o.id, o.market_id, o.status, o.payment_status, o.total_kmf, o.discount_kmf,
            o.wallet_applied_kmf, o.transport_price_kmf,
            o.cost_real_kmf, o.cost_transport_kmf, o.cost_douane_kmf,
            o.margin_real_pct, o.margin_alert, o.sourcing_blocked,
            ${customsUnknownForLinesSql('o')} AS customs_unknown,
            ${customsExpectedSql('o')} AS customs_expected
       FROM orders o WHERE o.id = $1`,
    [orderId]
  );
  return rows[0] || null;
}

async function _loadEstimated(orderId, q = db) {
  const landedCols = Object.keys(SNAPSHOT_LANDED_TO_REAL_COST_TYPE)
    .map((k) => `COALESCE(SUM(quantity * (cost_breakdown->'landed_relay'->>'${k}')::numeric), 0) AS e_${k}`)
    .join(',\n       ');
  const { rows } = await q.query(
    `SELECT COUNT(*)::int AS imputations_count,
            COUNT(*) FILTER (WHERE cost_breakdown IS NULL)::int AS missing_snapshot_count,
            ${landedCols},
            COALESCE(SUM(quantity * (cost_breakdown->'business'->>'payment')::numeric), 0) AS e_payment,
            COALESCE(SUM(quantity * (cost_breakdown->'business'->>'risk_provision')::numeric), 0) AS e_risk
       FROM order_item_cost_imputations WHERE order_id = $1`,
    [orderId]
  );
  return rows[0];
}

async function _loadReal(orderId, q = db) {
  const { rows } = await q.query(
    `SELECT cost_type, source, allocation_method, is_actual, SUM(amount_kmf) AS amount
       FROM order_item_real_cost_allocations WHERE order_id = $1
      GROUP BY cost_type, source, allocation_method, is_actual`,
    [orderId]
  );
  return rows;
}

async function _loadRefundsKmf(orderId, q = db) {
  const { rows } = await q.query(
    `SELECT COALESCE(SUM(amount_kmf) FILTER (WHERE status = 'completed'), 0) AS done,
            COALESCE(SUM(amount_kmf) FILTER (WHERE status <> 'completed'), 0) AS pending
       FROM refunds WHERE order_id = $1`,
    [orderId]
  );
  return rows[0];
}

async function _loadPurchase(orderId, q = db) {
  const { rows } = await q.query(
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
  const { rows: pay } = await q.query(
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

// ─── Coût d'achat réel (règlements KMF) ──────────────────────────────────────

async function _loadSettlementFacts(orderId, q = db) {
  const { rows: lines } = await q.query(
    `SELECT /* settle:lines */ pl.id, pl.purchase_order_id, pl.confirmed_at, pl.confirmed_quantity,
            pl.confirmed_unit_price::text AS confirmed_unit_price, pl.supplier_currency,
            (oi.order_id = $1) AS in_order
       FROM purchase_lines pl
       JOIN order_items oi ON oi.id = pl.order_item_id
      WHERE pl.cancelled_at IS NULL
        AND (oi.order_id = $1 OR pl.purchase_order_id IN (
              SELECT pl2.purchase_order_id FROM purchase_lines pl2
                JOIN order_items oi2 ON oi2.id = pl2.order_item_id
               WHERE oi2.order_id = $1 AND pl2.cancelled_at IS NULL AND pl2.purchase_order_id IS NOT NULL))`,
    [orderId]
  );
  const poIds = [...new Set(lines.map((l) => l.purchase_order_id).filter(Boolean))];
  if (!poIds.length) return { lines, payments: [], settlements: [] };
  const { rows: payments } = await q.query(
    `SELECT /* settle:payments */ id, purchase_order_id, status, real_debit_verified, reconciliation_status, currency
       FROM supplier_execution_payments WHERE purchase_order_id = ANY($1::uuid[])`,
    [poIds]
  );
  const payIds = payments.map((p) => p.id);
  const { rows: settlements } = payIds.length ? await q.query(
    `SELECT /* settle:settlements */ supplier_execution_payment_id, kind, amount_currency::text AS amount_currency, currency,
            amount_kmf::text AS amount_kmf, fees_kmf::text AS fees_kmf
       FROM supplier_payment_settlements WHERE supplier_execution_payment_id = ANY($1::uuid[])`,
    [payIds]
  ) : { rows: [] };
  return { lines, payments, settlements };
}

/** "12.3400" -> unités entières (BigInt) à `scale` décimales. */
function _units(v, scale) {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(v == null ? '0' : v));
  if (!m) return 0n;
  return BigInt(m[1]) * 10n ** BigInt(scale) + BigInt(((m[2] || '') + '0'.repeat(scale)).slice(0, scale) || '0');
}
const _roundCents = (u4) => (u4 + 50n) / 100n; // 1e-4 -> 1e-2, arrondi au plus proche
const _confirmed = (l) => l.confirmed_at != null && l.confirmed_unit_price != null && l.confirmed_quantity != null;

/**
 * Part de la commande dans le règlement réel de ses PO. Fonction pure (testable).
 * Ventilation par PO au prorata de la valeur confirmée des lignes actives de la PO
 * (plus grand reste, centimes KMF / 1e-4 devise), puis somme des lignes de la commande.
 * `real_kmf` n'est non-null que si TOUTES les conditions de preuve sont réunies.
 */
function computePurchaseReal({ lines, payments, settlements }) {
  const flags = new Set();
  const own = lines.filter((l) => l.in_order);
  const out = {
    complete: false, flags: [], settlements_count: settlements.length,
    paid: { amount_currency: null, currency: null, amount_kmf: 0 },
    refunds_goods_kmf: 0, fees_kmf: 0, effective_fx_rate: null, real_kmf: null,
  };
  if (!own.length) return out;
  if (own.some((l) => !l.purchase_order_id)) flags.add('line_without_purchase_order');
  if (own.some((l) => !_confirmed(l))) flags.add('unconfirmed_lines');

  const poIds = [...new Set(own.map((l) => l.purchase_order_id).filter(Boolean))];
  const acc = { payC: 0n, payK: 0n, goodsK: 0n, feesK: 0n }; // payC en 1e-4, K en centimes
  const currencies = new Set();
  let complete = !flags.size;

  for (const po of poIds) {
    const poLines = lines.filter((l) => l.purchase_order_id === po);
    if (poLines.some((l) => !_confirmed(l))) { flags.add('po_has_unconfirmed_lines'); complete = false; continue; }
    const poPays = payments.filter((p) => p.purchase_order_id === po);
    if (!poPays.length) { flags.add('no_supplier_payment'); complete = false; continue; }
    if (poPays.some((p) => !(p.status === 'succeeded' && p.real_debit_verified === true && p.reconciliation_status === 'matched'))) {
      flags.add('payment_not_verified_matched'); complete = false;
    }
    const payIds = new Set(poPays.map((p) => p.id));
    const sets = settlements.filter((x) => payIds.has(x.supplier_execution_payment_id));
    const lineCurrencies = new Set(poLines.map((l) => l.supplier_currency));
    const cc = lineCurrencies.size === 1 ? [...lineCurrencies][0] : null;
    if (!cc || sets.some((x) => x.currency !== cc)) { flags.add('currency_mismatch'); complete = false; }
    currencies.add(cc || 'MIXED');

    const sum = (kind, field, scale) => sets.filter((x) => x.kind === kind).reduce((a, x) => a + _units(x[field], scale), 0n);
    const payC = sum('payment', 'amount_currency', 4);
    const payK = sum('payment', 'amount_kmf', 2);
    const goodsC = sum('goods_refund', 'amount_currency', 4);
    const goodsK = sum('goods_refund', 'amount_kmf', 2);
    const feesK = sum('payment', 'fees_kmf', 2) - sum('fee_refund', 'amount_kmf', 2);
    if (payC === 0n) { flags.add('no_settlement_recorded'); complete = false; }

    // Couverture : valeur confirmée de toute la PO (1e-4) vs réglé net des remboursements de marchandises.
    const weights = poLines.map((l) => ({
      id: l.id, weight: Number(BigInt(l.confirmed_quantity) * _units(l.confirmed_unit_price, 4)),
    }));
    const value = poLines.reduce((a, l) => a + BigInt(l.confirmed_quantity) * _units(l.confirmed_unit_price, 4), 0n);
    if (value === 0n) { flags.add('zero_value_purchase_order'); complete = false; }
    const netC = _roundCents(payC - goodsC);
    const valC = _roundCents(value);
    if (payC > 0n && netC < valC) { flags.add('underpaid'); complete = false; }
    if (payC > 0n && netC > valC) { flags.add('overpaid'); complete = false; }

    const mine = new Set(own.filter((l) => l.purchase_order_id === po).map((l) => l.id));
    const share = (total) => shareByWeight(Number(total), weights)
      .filter((x) => mine.has(x.id)).reduce((a, x) => a + BigInt(x.share), 0n);
    acc.payC += share(payC); acc.payK += share(payK); acc.goodsK += share(goodsK); acc.feesK += share(feesK);
  }

  const cents = (b) => Number(b) / 100;
  out.flags = [...flags];
  out.complete = complete && poIds.length > 0;
  const single = currencies.size === 1 ? [...currencies][0] : null;
  out.paid = {
    amount_currency: single && single !== 'MIXED' ? Number(acc.payC) / 10000 : null,
    currency: currencies.size > 1 ? 'MIXED' : single,
    amount_kmf: cents(acc.payK),
  };
  out.refunds_goods_kmf = cents(acc.goodsK);
  out.fees_kmf = cents(acc.feesK);
  out.effective_fx_rate = single && single !== 'MIXED' && acc.payC > 0n
    ? Number((Number(acc.payK) / 100 / (Number(acc.payC) / 10000)).toFixed(6)) : null;
  out.real_kmf = out.complete ? cents(acc.payK - acc.goodsK) : null;
  return out;
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

function _classifyTypes({ est, realSplit, customsUnknown, customsExpected = true, purchaseInfo, purchaseReal }) {
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
      if (purchaseReal.complete && purchaseReal.real_kmf != null) {
        entry.state = 'real';
        entry.real_kmf = kmf(purchaseReal.real_kmf);
        entry.real_source = 'supplier_payment_settlements';
      } else if (purchaseInfo.confirmedLines > 0 && estimated > 0) {
        entry.state = 'confirmed_unvalued'; // prix confirmé, taux supporté absent
        unvalued.push(t);
      } else if (estimated > 0 || realSplit.catalog.amount > 0) {
        entry.state = 'estimated_only';
        entry.real_source = realSplit.catalog.amount > 0 ? 'catalog_estimate:products.cost_kmf' : null;
      }
    } else if (t === 'customs') {
      // Douane : jamais l'estimé figé (taux de catégorie = classification, pas un coût).
      // Réel = allocations d'expédition ; sinon inconnue ; non attendue si stock local.
      if (!customsExpected) {
        entry.state = 'not_expected';
      } else if (customsUnknown || (slot && !(slot.real > 0) && slot.fallback > 0)) {
        // Inconnue, ou seulement une ventilation non certifiée (is_actual=false).
        entry.state = 'unknown';
        unknown.push(t);
      } else {
        entry.state = 'real';
        entry.real_kmf = kmf(slot ? slot.real : 0);
        entry.real_source = slot && slot.sources.size ? [...slot.sources].join(',') : 'customs_shipment:zero_confirmed';
      }
    } else if (t === PAYMENT && !(slot && slot.real > 0) && purchaseReal.complete && purchaseReal.fees_kmf > 0) {
      // Frais réels (net des remboursements de frais) : REMPLACENT l'estimé, jamais additionnés.
      entry.state = 'real';
      entry.real_kmf = kmf(purchaseReal.fees_kmf);
      entry.real_source = 'supplier_payment_settlements:fees';
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
 * @param {{marketId?: string, client?: {query: Function}}} [opts] marketId de confiance (serveur) : isole par marché ;
 *        client = transaction de l'appelant (lecture cohérente avec ses écritures, A8)
 * @returns {Promise<object|null>} null si la commande n'existe pas (ou hors marché)
 */
async function computeOrderRealMarginShadow(orderId, opts = {}) {
  const q = opts.client || db; // transaction de l'appelant : lit ses écritures non commitées
  const o = await _loadOrder(orderId, q);
  if (!o) return null;
  if (opts.marketId && o.market_id !== opts.marketId) return null;

  const [est, realRows, refunds, purchase, settleFacts] = await Promise.all([
    _loadEstimated(orderId, q), _loadReal(orderId, q), _loadRefundsKmf(orderId, q), _loadPurchase(orderId, q),
    _loadSettlementFacts(orderId, q),
  ]);
  const purchaseReal = computePurchaseReal(settleFacts);

  const revenue = _revenue(o, refunds);
  const realSplit = _splitReal(realRows);
  const confirmedLines = purchase.lines.lines;
  const { by, unknown, unvalued } = _classifyTypes({
    est, realSplit, customsUnknown: o.customs_unknown === true,
    customsExpected: o.customs_expected !== false,
    purchaseInfo: { confirmedLines }, purchaseReal,
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
      paid: purchaseReal.paid,
      refunds_goods_kmf: purchaseReal.refunds_goods_kmf,
      fees_kmf: purchaseReal.fees_kmf,
      effective_fx_rate: purchaseReal.effective_fx_rate, // calculé Σ KMF / Σ devise ; null si rien réglé
      fx_borne: purchaseReal.effective_fx_rate,
      real_kmf: purchaseReal.complete ? purchaseReal.real_kmf : null, // centimes ; by_type est arrondi au KMF
      flags: purchaseReal.flags,
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

module.exports = { computeOrderRealMarginShadow, listRealMarginShadow, computePurchaseReal };
