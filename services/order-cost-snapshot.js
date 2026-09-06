/**
 * @komerce-arch
 * @role          orders-order-cost-snapshot
 * @domain        orders
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/pricing-engine.js, utils/logger.js
 * @used-by       routes/orders/create.js, services/cost-allocation/_helpers.js
 * @db-read       order_item_cost_imputations, order_items, products
 * @db-write      order_item_cost_imputations, orders
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  orders, checkout
 * @version       2026-09
 */

/**
 * KOMERCE — Order Cost Snapshot Service
 * ════════════════════════════════════════════════════════════════════════
 *
 * DOCTRINE :
 *   Au moment de la creation d'une commande (ou de la transformation d'un
 *   panier collectif en order), on FIGE le coût estimé tel que calculé par
 *   pricing-engine.recommend(). Cette photographie est immuable.
 *
 *   Le snapshot distingue désormais explicitement :
 *     - N1 : estimated_landed_relay_cost_kmf
 *     - N2 : estimated_business_variable_cost_kmf
 *     - N3 : estimated_fixed_overhead_kmf
 *     - CDR complet legacy : estimated_business_complete_cost_kmf
 *
 *   Cette séparation est nécessaire pour calculer la contribution
 *   (prix - N1 - N2) sans transformer N3 en dette du SKU.
 *
 *   Le snapshot est stocké dans order_item_cost_imputations avec contrainte
 *   UNIQUE sur order_item_id => idempotent par construction.
 *
 *   Si on rouvre la commande dans 6 mois, on retrouve EXACTEMENT le coût
 *   estimé au moment de la vente. Pas de derive due aux changements de
 *   taux/prix/charges.
 *
 * FEATURE FLAG :
 *   ORDER_COST_SNAPSHOT_ACTIVE (default false en prod)
 */

'use strict';

const db = require('../db');
const pricingEngine = require('./pricing-engine');
const log = require('../utils/logger').child({ module: 'order-cost-snapshot' });

function _isActive() {
  return String(process.env.ORDER_COST_SNAPSHOT_ACTIVE || '').toLowerCase() === 'true';
}

function _numberOrNull(value) {
  return value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
}

function _deriveCanonicalCosts(reco) {
  if (!reco) {
    return { n1: null, n2: null, n3: null, cdr: null };
  }

  const breakdown = reco.cost_breakdown || {};
  const business = breakdown.business || {};

  const n1 = _numberOrNull(
    reco.n1_landed_relay_cost_kmf != null
      ? reco.n1_landed_relay_cost_kmf
      : reco.landed_relay_cost_kmf
  );

  let n2 = _numberOrNull(reco.n2_business_variable_cost_kmf);
  if (n2 == null) {
    const payment = _numberOrNull(business.payment);
    const risk = _numberOrNull(business.risk_provision);
    if (payment != null && risk != null) n2 = payment + risk;
  }

  let n3 = _numberOrNull(
    reco.n3_fixed_overhead_allocation_kmf != null
      ? reco.n3_fixed_overhead_allocation_kmf
      : reco.fixed_cost_allocation_kmf
  );
  if (n3 == null) n3 = _numberOrNull(business.fixed_overhead);

  let cdr = _numberOrNull(
    reco.cdr_complete_kmf != null
      ? reco.cdr_complete_kmf
      : reco.business_complete_cost_kmf
  );
  if (cdr == null && n1 != null && n2 != null && n3 != null) cdr = n1 + n2 + n3;

  return { n1, n2, n3, cdr };
}

async function lockEstimatedCostsForOrder(orderId, dbClient, options = {}) {
  if (!_isActive()) {
    return {
      order_id: orderId,
      imputations_count: 0,
      skipped: true,
      reason: 'ORDER_COST_SNAPSHOT_ACTIVE=false',
      total_estimated_landed_kmf: 0,
      total_estimated_business_variable_kmf: 0,
      total_estimated_fixed_overhead_kmf: 0,
      total_estimated_business_kmf: 0,
    };
  }

  if (!dbClient) {
    throw new Error('lockEstimatedCostsForOrder: dbClient is required (must run in a transaction)');
  }

  const source = options.source || 'pricing-engine';

  const itemsRes = await dbClient.query(
    `SELECT oi.id AS order_item_id, oi.product_id, oi.quantity, oi.price_kmf,
            p.category, p.weight_kg, p.cost_kmf AS product_cost_kmf,
            p.volume_m3, o.market_id
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = $1
     ORDER BY oi.created_at`,
    [orderId]
  );

  if (!itemsRes.rows.length) {
    return {
      order_id: orderId,
      imputations_count: 0,
      skipped: true,
      reason: 'no_order_items',
      total_estimated_landed_kmf: 0,
      total_estimated_business_variable_kmf: 0,
      total_estimated_fixed_overhead_kmf: 0,
      total_estimated_business_kmf: 0,
    };
  }

  const orderMarketId = itemsRes.rows[0]?.market_id || null;
  const config = orderMarketId
    ? await pricingEngine.loadGlobalConfig({ marketId: orderMarketId })
    : await pricingEngine.loadGlobalConfig();

  let inserted = 0;
  let totalLanded = 0;
  let totalBusinessVariable = 0;
  let totalFixedOverhead = 0;
  let totalBusiness = 0;

  for (const item of itemsRes.rows) {
    let reco;
    try {
      reco = await pricingEngine.recommend({
        product_id: item.product_id || undefined,
        category: item.category,
        cost_kmf: item.product_cost_kmf,
        weight_kg: item.weight_kg,
        volume_m3: item.volume_m3,
        current_price_kmf: item.price_kmf,
      }, { config });
    } catch (err) {
      log.error('[order-cost-snapshot] pricing-engine failed for item', item.order_item_id, err.message);
      reco = null;
    }

    const quantity = Number(item.quantity) || 0;
    const saleTotal = Number(item.price_kmf) * quantity;
    const canonical = _deriveCanonicalCosts(reco);

    const estLandedTotal = canonical.n1 != null ? canonical.n1 * quantity : null;
    const estBusinessVariableTotal = canonical.n2 != null ? canonical.n2 * quantity : null;
    const estFixedOverheadTotal = canonical.n3 != null ? canonical.n3 * quantity : null;
    const estBusinessTotal = canonical.cdr != null ? canonical.cdr * quantity : null;

    let estMarginKmf = null;
    let estMarginPct = null;
    if (estBusinessTotal != null && saleTotal > 0) {
      estMarginKmf = saleTotal - estBusinessTotal;
      estMarginPct = Number(((estMarginKmf / saleTotal) * 100).toFixed(2));
    }

    const upsert = await dbClient.query(
      `INSERT INTO order_item_cost_imputations (
         order_id, order_item_id, product_id,
         quantity, sale_unit_price_kmf, sale_total_kmf,
         estimated_landed_relay_cost_kmf,
         estimated_business_complete_cost_kmf,
         estimated_business_variable_cost_kmf,
         estimated_fixed_overhead_kmf,
         estimated_margin_kmf,
         estimated_margin_pct,
         cost_breakdown,
         allocations,
         allocation_averages,
         allocation_confidence,
         data_quality,
         pricing_source
       ) VALUES (
         $1, $2, $3,
         $4, $5, $6,
         $7, $8, $9, $10,
         $11, $12,
         $13, $14, $15, $16, $17,
         $18
       )
       ON CONFLICT (order_item_id) DO NOTHING
       RETURNING id`,
      [
        orderId, item.order_item_id, item.product_id,
        quantity, item.price_kmf, saleTotal,
        estLandedTotal, estBusinessTotal, estBusinessVariableTotal, estFixedOverheadTotal,
        estMarginKmf, estMarginPct,
        reco?.cost_breakdown ? JSON.stringify(reco.cost_breakdown) : null,
        reco?.cost_breakdown?.allocations ? JSON.stringify(reco.cost_breakdown.allocations) : null,
        reco?.cost_breakdown?.allocation_averages ? JSON.stringify(reco.cost_breakdown.allocation_averages) : null,
        reco?.cost_breakdown?.allocation_averages?.confidence || null,
        reco?.data_quality ? JSON.stringify(reco.data_quality) : null,
        reco ? source : 'fallback',
      ]
    );

    if (upsert.rows.length) {
      inserted++;
      if (estLandedTotal != null) totalLanded += estLandedTotal;
      if (estBusinessVariableTotal != null) totalBusinessVariable += estBusinessVariableTotal;
      if (estFixedOverheadTotal != null) totalFixedOverhead += estFixedOverheadTotal;
      if (estBusinessTotal != null) totalBusiness += estBusinessTotal;
    }
  }

  if (inserted > 0) {
    await dbClient.query(
      `UPDATE orders
         SET cost_estimated_kmf = (
           SELECT COALESCE(SUM(estimated_business_complete_cost_kmf), 0)::int
           FROM order_item_cost_imputations
           WHERE order_id = $1
         )
       WHERE id = $1`,
      [orderId]
    );
  }

  return {
    order_id: orderId,
    imputations_count: inserted,
    skipped: false,
    total_estimated_landed_kmf: Math.round(totalLanded),
    total_estimated_business_variable_kmf: Math.round(totalBusinessVariable),
    total_estimated_fixed_overhead_kmf: Math.round(totalFixedOverhead),
    total_estimated_business_kmf: Math.round(totalBusiness),
  };
}

module.exports = {
  lockEstimatedCostsForOrder,
  _isActive,
  _deriveCanonicalCosts,
};
