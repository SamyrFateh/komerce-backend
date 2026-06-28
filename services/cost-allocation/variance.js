/**
 * @komerce-arch
 * @role          economic-engine-cost-allocation-variance
 * @domain        economic-engine
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db
 * @used-by       services/cost-allocation/index.js
 * @db-read       order_item_cost_imputations, order_item_real_cost_allocations, order_items, orders
 * @db-write      (none)
 * @db-txn        @none
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine, admin-costing
 * @version       2026-06
 */

/**
 * KOMERCE — Cost Allocation — Variance & vérité économique (Lot C5)
 * ════════════════════════════════════════════════════════════════════════
 *
 * Extrait de services/cost-allocation.js (914L) — Lot B/C Refacto.
 *
 * REGLE ABSOLUE (héritée du module d'origine) :
 *   Si un coût reel manque, on NE le met JAMAIS a 0.
 *   getOrderCostTruth retourne plutôt cost_status = 'partial_real' ou
 *   'incomplete' + missing_cost_fields = ['fixed_overhead', 'payment', ...].
 *   Le dashboard ne doit JAMAIS afficher une marge reelle partielle sans
 *   le signaler explicitement.
 *
 * Couvertes par tests/unit/cost-allocation.test.js (sections
 * computeOrderCostVariance / computeProductCostVariance / getOrderCostTruth).
 */

'use strict';

const db = require('../../db');

// ═══════════════════════════════════════════════════════════════════════
// 6. computeOrderCostVariance — compare estime vs reel par cost_type
// ═══════════════════════════════════════════════════════════════════════

async function computeOrderCostVariance(orderId) {
  // Estime
  const estRes = await db.query(
    `SELECT
       SUM(estimated_landed_relay_cost_kmf) AS landed,
       SUM(estimated_business_complete_cost_kmf) AS business,
       SUM(estimated_margin_kmf) AS margin,
       jsonb_object_agg(
         coalesce(cb_key.k, 'unknown'),
         coalesce((cost_breakdown->cb_key.k->>'total')::numeric, 0)
       ) FILTER (WHERE cost_breakdown IS NOT NULL) AS by_cost_type
     FROM order_item_cost_imputations imp
     LEFT JOIN LATERAL jsonb_object_keys(imp.cost_breakdown) cb_key(k) ON TRUE
     WHERE order_id = $1`,
    [orderId]
  );

  // Reel
  const realRes = await db.query(
    `SELECT cost_type, SUM(amount_kmf) AS amount
     FROM order_item_real_cost_allocations
     WHERE order_id = $1
     GROUP BY cost_type`,
    [orderId]
  );

  const realByType = {};
  let totalReal = 0;
  for (const r of realRes.rows) {
    realByType[r.cost_type] = Number(r.amount);
    totalReal += Number(r.amount);
  }

  const est = estRes.rows[0] || {};
  const totalEstBusiness = Number(est.business) || 0;
  const totalEstLanded = Number(est.landed) || 0;

  return {
    order_id: orderId,
    estimated: {
      landed_kmf: Math.round(totalEstLanded),
      business_kmf: Math.round(totalEstBusiness),
      by_cost_type: est.by_cost_type || {},
    },
    real: {
      total_kmf: Math.round(totalReal),
      by_cost_type: realByType,
    },
    variance: {
      total_kmf: Math.round(totalReal - totalEstBusiness),
      total_pct: totalEstBusiness > 0
        ? Number((((totalReal - totalEstBusiness) / totalEstBusiness) * 100).toFixed(2))
        : null,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 7. computeProductCostVariance — agrege par produit sur N commandes
// ═══════════════════════════════════════════════════════════════════════

async function computeProductCostVariance(productId, options = {}) {
  // NOTE: options.from / options.to non supportés dans cette version — simpleSql lit tous les orders.
  // La version filtrée par dates (sql complexe avec $${i-2}) avait un bug de paramétrage et n'était pas utilisée.
  // À implémenter proprement si besoin filtrage par date.

  // Version robuste (filtre uniquement par product_id)
  const simpleSql = `
    SELECT
      imp.product_id,
      SUM(imp.quantity)::int AS quantity_sold,
      SUM(imp.estimated_business_complete_cost_kmf) AS total_estimated_kmf,
      COALESCE((
        SELECT SUM(alc.amount_kmf)
        FROM order_item_real_cost_allocations alc
        WHERE alc.order_item_id IN (
          SELECT id FROM order_items WHERE product_id = $1
        )
      ), 0) AS total_real_kmf,
      COUNT(DISTINCT imp.order_id)::int AS orders_count
    FROM order_item_cost_imputations imp
    WHERE imp.product_id = $1
    GROUP BY imp.product_id
  `;
  const r = await db.query(simpleSql, [productId]);
  if (!r.rows.length) {
    return { product_id: productId, no_data: true };
  }
  const row = r.rows[0];
  const est = Number(row.total_estimated_kmf) || 0;
  const real = Number(row.total_real_kmf) || 0;
  return {
    product_id: row.product_id,
    quantity_sold: row.quantity_sold,
    orders_count: row.orders_count,
    total_estimated_kmf: Math.round(est),
    total_real_kmf: Math.round(real),
    variance_kmf: Math.round(real - est),
    variance_pct: est > 0 ? Number((((real - est) / est) * 100).toFixed(2)) : null,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 8. getOrderCostTruth — verite economique complete d'une order
// ═══════════════════════════════════════════════════════════════════════

/**
 * Retourne la verite complete sur une commande :
 *   - estime (depuis order_item_cost_imputations)
 *   - reel (depuis order_item_real_cost_allocations, par cost_type)
 *   - variance
 *   - cost_status : 'estimated' | 'partial_real' | 'actual' | 'incomplete'
 *   - missing_cost_fields : liste des cost_types manquants
 *
 * REGLE : on ne met JAMAIS 0 pour un cout manquant. On le declare 'missing'
 * dans missing_cost_fields. Le dashboard sait ainsi quoi afficher en transparence.
 */
async function getOrderCostTruth(orderId) {
  // 1. Charger order
  const orderRes = await db.query(
    `SELECT id, reference, status, payment_status, total_kmf, created_at
     FROM orders WHERE id = $1`,
    [orderId]
  );
  if (!orderRes.rows.length) return null;
  const order = orderRes.rows[0];

  // 2. Estime agrégé
  const estRes = await db.query(
    `SELECT
       COUNT(*) AS imputations_count,
       SUM(quantity) AS items_quantity,
       SUM(sale_total_kmf) AS sale_total,
       SUM(estimated_landed_relay_cost_kmf) AS estimated_landed,
       SUM(estimated_business_complete_cost_kmf) AS estimated_business,
       SUM(estimated_margin_kmf) AS estimated_margin
     FROM order_item_cost_imputations
     WHERE order_id = $1`,
    [orderId]
  );
  const est = estRes.rows[0] || {};

  // 3. Reel par cost_type
  const realRes = await db.query(
    `SELECT cost_type, SUM(amount_kmf) AS amount, BOOL_AND(is_actual) AS all_actual
     FROM order_item_real_cost_allocations
     WHERE order_id = $1
     GROUP BY cost_type`,
    [orderId]
  );

  const realByType = {};
  let totalRealKmf = 0;
  for (const r of realRes.rows) {
    realByType[r.cost_type] = {
      amount_kmf: Math.round(Number(r.amount)),
      is_actual: r.all_actual,
    };
    totalRealKmf += Number(r.amount);
  }

  // 4. Determiner cost_status + missing_cost_fields
  // ENUM CANONIQUE (Sprint 1) :
  //   estimated      = snapshot pricing-engine seul, aucun cout reel alloue
  //   partial_real   = couts variables alloues mais pas tous les types attendus
  //   actual         = tous les types attendus alloues (= ex-'complete')
  //   incomplete     = imputation absente / cas pathologique
  const expectedVariable = ['product_purchase', 'freight', 'customs', 'local_distribution', 'relay'];
  const expectedFixed = ['hub', 'risk_provision', 'fixed_overhead'];
  const expectedAll = [...expectedVariable, ...expectedFixed, 'payment'];

  const present = Object.keys(realByType);
  const missingVariable = expectedVariable.filter(t => !present.includes(t));
  const missingFixed = expectedFixed.filter(t => !present.includes(t));
  const missingPayment = !present.includes('payment') ? ['payment'] : [];

  const missing = [...missingVariable, ...missingFixed, ...missingPayment];

  let costStatus;
  if (Number(est.imputations_count) === 0) {
    costStatus = 'incomplete';            // ex 'no_imputations'
  } else if (totalRealKmf === 0) {
    costStatus = 'estimated';             // ex 'provisional'
  } else if (missingVariable.length > 0) {
    costStatus = 'partial_real';
  } else if (missingFixed.length > 0 || missingPayment.length > 0) {
    costStatus = 'partial_real';
  } else {
    costStatus = 'actual';                // ex 'complete'
  }

  // 5. Marge reelle UNIQUEMENT si actual
  const sale = Number(est.sale_total) || Number(order.total_kmf) || 0;
  const realMarginKmf = costStatus === 'actual' ? (sale - totalRealKmf) : null;
  const realMarginPct = (realMarginKmf != null && sale > 0)
    ? Number(((realMarginKmf / sale) * 100).toFixed(2))
    : null;

  // Variance
  const totalEstBusiness = Number(est.estimated_business) || 0;
  const variance = totalRealKmf > 0 && totalEstBusiness > 0 ? {
    total_kmf: Math.round(totalRealKmf - totalEstBusiness),
    total_pct: Number((((totalRealKmf - totalEstBusiness) / totalEstBusiness) * 100).toFixed(2)),
  } : null;

  return {
    order_id: order.id,
    reference: order.reference,
    status: order.status,
    payment_status: order.payment_status,
    sale: {
      total_kmf: Math.round(sale),
    },
    estimated: {
      landed_relay_cost_kmf: Math.round(Number(est.estimated_landed) || 0),
      business_complete_cost_kmf: Math.round(totalEstBusiness),
      margin_kmf: Math.round(Number(est.estimated_margin) || 0),
      margin_pct: totalEstBusiness > 0 && sale > 0
        ? Number(((sale - totalEstBusiness) / sale * 100).toFixed(2))
        : null,
      imputations_count: Number(est.imputations_count),
    },
    real: {
      total_kmf: totalRealKmf > 0 ? Math.round(totalRealKmf) : null,
      margin_kmf: realMarginKmf != null ? Math.round(realMarginKmf) : null,
      margin_pct: realMarginPct,
      by_cost_type: realByType,
    },
    variance,
    cost_status: costStatus,
    missing_cost_fields: missing,
  };
}


module.exports = {
  computeOrderCostVariance,
  computeProductCostVariance,
  getOrderCostTruth,
};
