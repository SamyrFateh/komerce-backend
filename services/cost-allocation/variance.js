/**
 * @komerce-arch
 * @role          economic-engine-cost-allocation-variance
 * @domain        economic-engine
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/cost-allocation/cost-types.js
 * @used-by       services/cost-allocation/index.js
 * @db-read       order_item_cost_imputations, order_item_real_cost_allocations, order_items, orders
 * @db-write      (none)
 * @db-txn        @none
 * @doctrine      pricing_market_viability_cost_scope
 * @impact-areas  economic-engine, admin-costing
 * @version       2026-09
 */

/**
 * KOMERCE — Cost Allocation — Variance & vérité économique
 * ════════════════════════════════════════════════════════════════════════
 *
 * Invariant : une variance n'est calculée qu'entre périmètres comparables.
 * La piste commande/article réconcilie ici les coûts variables réellement
 * constatables au niveau transaction : N1 + paiement réel.
 *
 * `risk_provision` reste bien dans N2 pour le calcul de contribution, mais
 * sa vérité est une réconciliation de période (provisions vs sinistres), pas
 * un décaissement de commande. Il est donc publié séparément et ne sert pas
 * de preuve de statut `actual` ni de variance transactionnelle.
 *
 * N3 reste une vérité de période et n'entre jamais dans cette variance.
 * Un cost_type inconnu rend le résultat NOT_DECISIONAL : aucune catégorie
 * inventée ne tombe silencieusement dans le variable réel.
 */

'use strict';

const db = require('../../db');
const {
  SNAPSHOT_LANDED_TO_REAL_COST_TYPE,
  RECONCILIABLE_VARIABLE_COST_TYPES,
  N2_PROVISION_COST_TYPES,
  ORDER_ALLOCATION_STRUCTURE_COST_TYPES,
  classifyOrderAllocationCostType,
} = require('./cost-types');

function _roundOrNull(value) {
  return value == null || !Number.isFinite(Number(value)) ? null : Math.round(Number(value));
}

function _splitRealRows(rows) {
  const byType = {};
  const variableByType = {};
  const provisionByType = {};
  const structureByType = {};
  const unknownByType = {};
  let total = 0;
  let variableTotal = 0;
  let provisionTotal = 0;
  let structureTotal = 0;
  let unknownTotal = 0;

  for (const row of rows || []) {
    const amount = Number(row.amount) || 0;
    byType[row.cost_type] = amount;
    total += amount;

    const scope = classifyOrderAllocationCostType(row.cost_type);
    if (scope === 'variable_actual') {
      variableByType[row.cost_type] = amount;
      variableTotal += amount;
    } else if (scope === 'provision') {
      provisionByType[row.cost_type] = amount;
      provisionTotal += amount;
    } else if (scope === 'structure_legacy') {
      structureByType[row.cost_type] = amount;
      structureTotal += amount;
    } else {
      unknownByType[row.cost_type] = amount;
      unknownTotal += amount;
    }
  }

  return {
    byType,
    variableByType,
    provisionByType,
    structureByType,
    unknownByType,
    total,
    variableTotal,
    provisionTotal,
    structureTotal,
    unknownTotal,
  };
}

function _variance(realValue, estimatedValue) {
  if (estimatedValue == null) return null;
  return {
    scope: 'N1+payment',
    total_kmf: Math.round(realValue - estimatedValue),
    total_pct: estimatedValue > 0
      ? Number((((realValue - estimatedValue) / estimatedValue) * 100).toFixed(2))
      : null,
  };
}

function _riskProvisionFromEstimate(est) {
  if (est.estimated_risk_provision == null && est.risk_provision == null) return 0;
  return Number(est.estimated_risk_provision != null ? est.estimated_risk_provision : est.risk_provision) || 0;
}

function _expectedActualTypesFromEstimate(est) {
  const expected = [];
  for (const [snapshotKey, realType] of Object.entries(SNAPSHOT_LANDED_TO_REAL_COST_TYPE)) {
    if ((Number(est[`expected_${snapshotKey}`]) || 0) > 0) expected.push(realType);
  }
  if ((Number(est.expected_payment) || 0) > 0) expected.push('payment');
  return expected;
}

// ═══════════════════════════════════════════════════════════════════════
// 6. computeOrderCostVariance — estimé vs réel sur N1 + paiement
// ═══════════════════════════════════════════════════════════════════════

async function computeOrderCostVariance(orderId) {
  const estRes = await db.query(
    `SELECT
       SUM(estimated_landed_relay_cost_kmf) AS landed,
       SUM(estimated_business_complete_cost_kmf) AS business_complete,
       SUM(estimated_business_variable_cost_kmf) AS business_variable,
       SUM(estimated_fixed_overhead_kmf) AS fixed_overhead,
       SUM(COALESCE((cost_breakdown->'business'->>'risk_provision')::numeric, 0)) AS risk_provision,
       COUNT(*)::int AS imputations_count,
       COUNT(*) FILTER (
         WHERE estimated_landed_relay_cost_kmf IS NULL
            OR estimated_business_variable_cost_kmf IS NULL
            OR cost_breakdown IS NULL
       )::int AS missing_variable_snapshot_count
     FROM order_item_cost_imputations
     WHERE order_id = $1`,
    [orderId]
  );

  const realRes = await db.query(
    `SELECT cost_type, SUM(amount_kmf) AS amount, BOOL_AND(is_actual) AS all_actual
     FROM order_item_real_cost_allocations
     WHERE order_id = $1
     GROUP BY cost_type`,
    [orderId]
  );

  const est = estRes.rows[0] || {};
  const landed = est.landed == null ? null : Number(est.landed);
  const businessVariable = est.business_variable == null ? null : Number(est.business_variable);
  const fixedOverhead = est.fixed_overhead == null ? null : Number(est.fixed_overhead);
  const businessComplete = est.business_complete == null ? null : Number(est.business_complete);
  const riskProvision = Number(est.risk_provision) || 0;
  const missingVariableSnapshotCount = Number(est.missing_variable_snapshot_count) || 0;

  const estimatedContributionCost = missingVariableSnapshotCount === 0 && landed != null && businessVariable != null
    ? landed + businessVariable
    : null;
  const estimatedReconcilableVariable = estimatedContributionCost == null
    ? null
    : estimatedContributionCost - riskProvision;

  const real = _splitRealRows(realRes.rows);
  const comparable = estimatedReconcilableVariable != null && real.unknownTotal === 0;

  return {
    order_id: orderId,
    estimated: {
      landed_kmf: _roundOrNull(landed),
      business_kmf: _roundOrNull(businessComplete), // alias legacy = CDR complet
      business_complete_kmf: _roundOrNull(businessComplete),
      business_variable_kmf: _roundOrNull(businessVariable),
      risk_provision_kmf: _roundOrNull(riskProvision),
      fixed_overhead_kmf: _roundOrNull(fixedOverhead),
      variable_total_kmf: _roundOrNull(estimatedReconcilableVariable),
      contribution_cost_total_kmf: _roundOrNull(estimatedContributionCost),
      missing_variable_snapshot_count: missingVariableSnapshotCount,
    },
    real: {
      total_kmf: Math.round(real.total),
      variable_total_kmf: Math.round(real.variableTotal),
      provision_total_kmf: Math.round(real.provisionTotal),
      structure_total_kmf: Math.round(real.structureTotal),
      unknown_total_kmf: Math.round(real.unknownTotal),
      by_cost_type: real.byType,
      variable_by_cost_type: real.variableByType,
      provision_by_cost_type: real.provisionByType,
      structure_by_cost_type: real.structureByType,
      unknown_by_cost_type: real.unknownByType,
    },
    variance: comparable ? _variance(real.variableTotal, estimatedReconcilableVariable) : null,
    reconciliation_status: comparable ? 'comparable_scope' : 'not_decisional',
    risk_provision_status: riskProvision > 0 ? 'period_reconciliation_pending' : 'not_applicable',
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 7. computeProductCostVariance — agrégé par produit sur une fenêtre
// ═══════════════════════════════════════════════════════════════════════

async function computeProductCostVariance(productId, options = {}) {
  const params = [productId];
  const impWhere = ['imp.product_id = $1'];
  const realWhere = ['oi.product_id = $1'];

  if (options.from) {
    params.push(options.from);
    const idx = params.length;
    impWhere.push(`o.created_at >= $${idx}`);
    realWhere.push(`ro.created_at >= $${idx}`);
  }
  if (options.to) {
    params.push(options.to);
    const idx = params.length;
    impWhere.push(`o.created_at <= $${idx}`);
    realWhere.push(`ro.created_at <= $${idx}`);
  }

  params.push(RECONCILIABLE_VARIABLE_COST_TYPES);
  const variableTypesParam = `$${params.length}`;
  params.push(N2_PROVISION_COST_TYPES);
  const provisionTypesParam = `$${params.length}`;
  params.push(ORDER_ALLOCATION_STRUCTURE_COST_TYPES);
  const structureTypesParam = `$${params.length}`;

  const sql = `
    WITH scoped_imp AS (
      SELECT imp.*
      FROM order_item_cost_imputations imp
      JOIN orders o ON o.id = imp.order_id
      WHERE ${impWhere.join(' AND ')}
    ),
    scoped_real AS (
      SELECT alc.cost_type, alc.amount_kmf
      FROM order_item_real_cost_allocations alc
      JOIN order_items oi ON oi.id = alc.order_item_id
      JOIN orders ro ON ro.id = oi.order_id
      WHERE ${realWhere.join(' AND ')}
    )
    SELECT
      imp.product_id,
      SUM(imp.quantity)::int AS quantity_sold,
      COUNT(DISTINCT imp.order_id)::int AS orders_count,
      COUNT(*) FILTER (
        WHERE imp.estimated_landed_relay_cost_kmf IS NULL
           OR imp.estimated_business_variable_cost_kmf IS NULL
           OR imp.cost_breakdown IS NULL
      )::int AS missing_variable_snapshot_count,
      CASE
        WHEN COUNT(*) FILTER (
          WHERE imp.estimated_landed_relay_cost_kmf IS NULL
             OR imp.estimated_business_variable_cost_kmf IS NULL
             OR imp.cost_breakdown IS NULL
        ) > 0 THEN NULL
        ELSE SUM(
          imp.estimated_landed_relay_cost_kmf
          + imp.estimated_business_variable_cost_kmf
          - COALESCE((imp.cost_breakdown->'business'->>'risk_provision')::numeric, 0)
        )
      END AS total_estimated_variable_kmf,
      CASE
        WHEN COUNT(*) FILTER (
          WHERE imp.estimated_landed_relay_cost_kmf IS NULL
             OR imp.estimated_business_variable_cost_kmf IS NULL
             OR imp.cost_breakdown IS NULL
        ) > 0 THEN NULL
        ELSE SUM(imp.estimated_landed_relay_cost_kmf + imp.estimated_business_variable_cost_kmf)
      END AS total_estimated_contribution_cost_kmf,
      SUM(COALESCE((imp.cost_breakdown->'business'->>'risk_provision')::numeric, 0)) AS total_estimated_risk_provision_kmf,
      COALESCE((
        SELECT SUM(sr.amount_kmf)
        FROM scoped_real sr
        WHERE sr.cost_type = ANY(${variableTypesParam}::text[])
      ), 0) AS total_real_variable_kmf,
      COALESCE((
        SELECT SUM(sr.amount_kmf)
        FROM scoped_real sr
        WHERE sr.cost_type = ANY(${provisionTypesParam}::text[])
      ), 0) AS total_real_provision_kmf,
      COALESCE((
        SELECT SUM(sr.amount_kmf)
        FROM scoped_real sr
        WHERE sr.cost_type = ANY(${structureTypesParam}::text[])
      ), 0) AS total_real_structure_kmf,
      COALESCE((
        SELECT SUM(sr.amount_kmf)
        FROM scoped_real sr
        WHERE NOT (sr.cost_type = ANY(${variableTypesParam}::text[]))
          AND NOT (sr.cost_type = ANY(${provisionTypesParam}::text[]))
          AND NOT (sr.cost_type = ANY(${structureTypesParam}::text[]))
      ), 0) AS total_real_unknown_kmf
    FROM scoped_imp imp
    GROUP BY imp.product_id
  `;

  const result = await db.query(sql, params);
  if (!result.rows.length) {
    return { product_id: productId, no_data: true };
  }

  const row = result.rows[0];
  const estimated = row.total_estimated_variable_kmf == null ? null : Number(row.total_estimated_variable_kmf);
  const estimatedContribution = row.total_estimated_contribution_cost_kmf == null
    ? null
    : Number(row.total_estimated_contribution_cost_kmf);
  const estimatedRisk = Number(row.total_estimated_risk_provision_kmf) || 0;
  const realVariable = Number(row.total_real_variable_kmf) || 0;
  const realProvision = Number(row.total_real_provision_kmf) || 0;
  const realStructure = Number(row.total_real_structure_kmf) || 0;
  const realUnknown = Number(row.total_real_unknown_kmf) || 0;
  const comparable = estimated != null && realUnknown === 0;
  const variance = comparable ? _variance(realVariable, estimated) : null;

  return {
    product_id: row.product_id,
    quantity_sold: row.quantity_sold,
    orders_count: row.orders_count,
    from: options.from || null,
    to: options.to || null,
    total_estimated_kmf: _roundOrNull(estimated), // alias legacy : périmètre réconciliable N1 + paiement
    total_real_kmf: Math.round(realVariable),      // alias legacy : même périmètre
    total_estimated_variable_kmf: _roundOrNull(estimated),
    total_estimated_contribution_cost_kmf: _roundOrNull(estimatedContribution),
    total_estimated_risk_provision_kmf: Math.round(estimatedRisk),
    total_real_variable_kmf: Math.round(realVariable),
    total_real_provision_kmf: Math.round(realProvision),
    total_real_structure_kmf: Math.round(realStructure),
    total_real_unknown_kmf: Math.round(realUnknown),
    variance_kmf: variance ? variance.total_kmf : null,
    variance_pct: variance ? variance.total_pct : null,
    variance_scope: 'N1+payment',
    missing_variable_snapshot_count: Number(row.missing_variable_snapshot_count) || 0,
    reconciliation_status: comparable ? 'comparable_scope' : 'not_decisional',
    risk_provision_status: estimatedRisk > 0 ? 'period_reconciliation_pending' : 'not_applicable',
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 8. getOrderCostTruth — vérité variable transactionnelle d'une order
// ═══════════════════════════════════════════════════════════════════════

async function getOrderCostTruth(orderId) {
  const orderRes = await db.query(
    `SELECT id, reference, status, payment_status, total_kmf, created_at
     FROM orders WHERE id = $1`,
    [orderId]
  );
  if (!orderRes.rows.length) return null;
  const order = orderRes.rows[0];

  const estRes = await db.query(
    `SELECT
       COUNT(*) AS imputations_count,
       SUM(quantity) AS items_quantity,
       SUM(sale_total_kmf) AS sale_total,
       SUM(estimated_landed_relay_cost_kmf) AS estimated_landed,
       SUM(estimated_business_complete_cost_kmf) AS estimated_business,
       SUM(estimated_business_variable_cost_kmf) AS estimated_business_variable,
       SUM(estimated_fixed_overhead_kmf) AS estimated_fixed_overhead,
       SUM(COALESCE((cost_breakdown->'business'->>'risk_provision')::numeric, 0)) AS estimated_risk_provision,
       SUM(COALESCE((cost_breakdown->'landed_relay'->>'product_purchase')::numeric, 0)) AS expected_product_purchase,
       SUM(COALESCE((cost_breakdown->'landed_relay'->>'sourcing')::numeric, 0)) AS expected_sourcing,
       SUM(COALESCE((cost_breakdown->'landed_relay'->>'hub')::numeric, 0)) AS expected_hub,
       SUM(COALESCE((cost_breakdown->'landed_relay'->>'packaging')::numeric, 0)) AS expected_packaging,
       SUM(COALESCE((cost_breakdown->'landed_relay'->>'freight')::numeric, 0)) AS expected_freight,
       SUM(COALESCE((cost_breakdown->'landed_relay'->>'customs')::numeric, 0)) AS expected_customs,
       SUM(COALESCE((cost_breakdown->'landed_relay'->>'port_transitary')::numeric, 0)) AS expected_port_transitary,
       SUM(COALESCE((cost_breakdown->'landed_relay'->>'local_distribution')::numeric, 0)) AS expected_local_distribution,
       SUM(COALESCE((cost_breakdown->'landed_relay'->>'relay')::numeric, 0)) AS expected_relay,
       SUM(COALESCE((cost_breakdown->'business'->>'payment')::numeric, 0)) AS expected_payment,
       COUNT(*) FILTER (
         WHERE estimated_landed_relay_cost_kmf IS NULL
            OR estimated_business_variable_cost_kmf IS NULL
            OR cost_breakdown IS NULL
       ) AS missing_variable_snapshot_count,
       SUM(estimated_margin_kmf) AS estimated_margin
     FROM order_item_cost_imputations
     WHERE order_id = $1`,
    [orderId]
  );
  const est = estRes.rows[0] || {};

  const realRes = await db.query(
    `SELECT cost_type, SUM(amount_kmf) AS amount, BOOL_AND(is_actual) AS all_actual
     FROM order_item_real_cost_allocations
     WHERE order_id = $1
     GROUP BY cost_type`,
    [orderId]
  );

  const realByType = {};
  let totalRealKmf = 0;
  for (const row of realRes.rows) {
    realByType[row.cost_type] = {
      amount_kmf: Math.round(Number(row.amount)),
      is_actual: row.all_actual,
    };
    totalRealKmf += Number(row.amount);
  }

  const present = Object.keys(realByType);
  const expectedActualTypes = _expectedActualTypesFromEstimate(est);
  const missingVariable = expectedActualTypes.filter(t => !present.includes(t));
  const unknown = present.filter(t => classifyOrderAllocationCostType(t) === 'unknown');

  let costStatus;
  if (Number(est.imputations_count) === 0) costStatus = 'incomplete';
  else if (totalRealKmf === 0) costStatus = 'estimated';
  else if (missingVariable.length > 0 || unknown.length > 0) costStatus = 'partial_real';
  else costStatus = 'actual'; // alias contractuel conservé pour admin-costing

  const sale = Number(est.sale_total) || Number(order.total_kmf) || 0;
  const totalEstBusiness = est.estimated_business == null ? null : Number(est.estimated_business);
  const totalEstLanded = est.estimated_landed == null ? null : Number(est.estimated_landed);
  const totalEstN2 = est.estimated_business_variable == null ? null : Number(est.estimated_business_variable);
  const totalEstN3 = est.estimated_fixed_overhead == null ? null : Number(est.estimated_fixed_overhead);
  const totalEstRisk = _riskProvisionFromEstimate(est);
  const missingVariableSnapshotCount = Number(est.missing_variable_snapshot_count) || 0;
  const totalEstContributionCost = missingVariableSnapshotCount === 0 && totalEstLanded != null && totalEstN2 != null
    ? totalEstLanded + totalEstN2
    : null;
  const totalEstVariable = totalEstContributionCost == null ? null : totalEstContributionCost - totalEstRisk;

  const realSplitRows = realRes.rows.map(row => ({ cost_type: row.cost_type, amount: row.amount }));
  const realSplit = _splitRealRows(realSplitRows);
  const comparable = totalEstVariable != null && realSplit.unknownTotal === 0;
  const variance = comparable ? _variance(realSplit.variableTotal, totalEstVariable) : null;

  // Contribution économique : coût variable réellement réconciliable + provision
  // risque issue du snapshot. La provision reste marquée "pending" jusqu'à sa
  // réconciliation de période ; elle n'est jamais promue en décaissement réel.
  const contributionCostKmf = costStatus === 'actual'
    ? realSplit.variableTotal + totalEstRisk
    : null;
  const contributionKmf = contributionCostKmf != null ? sale - contributionCostKmf : null;
  const contributionPct = (contributionKmf != null && sale > 0)
    ? Number(((contributionKmf / sale) * 100).toFixed(2))
    : null;

  return {
    order_id: order.id,
    reference: order.reference,
    status: order.status,
    payment_status: order.payment_status,
    sale: {
      total_kmf: Math.round(sale),
    },
    estimated: {
      landed_relay_cost_kmf: _roundOrNull(totalEstLanded),
      business_complete_cost_kmf: _roundOrNull(totalEstBusiness),
      business_variable_cost_kmf: _roundOrNull(totalEstN2),
      risk_provision_kmf: _roundOrNull(totalEstRisk),
      fixed_overhead_kmf: _roundOrNull(totalEstN3),
      variable_total_kmf: _roundOrNull(totalEstVariable),
      contribution_cost_total_kmf: _roundOrNull(totalEstContributionCost),
      margin_kmf: _roundOrNull(est.estimated_margin),
      margin_pct: totalEstBusiness != null && sale > 0
        ? Number(((sale - totalEstBusiness) / sale * 100).toFixed(2))
        : null,
      imputations_count: Number(est.imputations_count),
      missing_variable_snapshot_count: missingVariableSnapshotCount,
    },
    real: {
      total_kmf: totalRealKmf > 0 ? Math.round(totalRealKmf) : null,
      variable_total_kmf: totalRealKmf > 0 ? Math.round(realSplit.variableTotal) : null,
      provision_legacy_total_kmf: totalRealKmf > 0 ? Math.round(realSplit.provisionTotal) : null,
      structure_legacy_total_kmf: totalRealKmf > 0 ? Math.round(realSplit.structureTotal) : null,
      unknown_total_kmf: totalRealKmf > 0 ? Math.round(realSplit.unknownTotal) : null,
      contribution_cost_total_kmf: contributionCostKmf != null ? Math.round(contributionCostKmf) : null,
      margin_kmf: contributionKmf != null ? Math.round(contributionKmf) : null,
      margin_pct: contributionPct,
      by_cost_type: realByType,
    },
    variance,
    reconciliation_status: comparable ? 'comparable_scope' : 'not_decisional',
    cost_status: costStatus,
    cost_status_scope: 'transaction_variable_actual_with_period_risk_provision',
    missing_cost_fields: [...missingVariable, ...unknown.map(t => `unknown:${t}`)],
    risk_provision_status: totalEstRisk > 0 ? 'period_reconciliation_pending' : 'not_applicable',
    structure_period_status: 'not_evaluated_here',
  };
}

module.exports = {
  computeOrderCostVariance,
  computeProductCostVariance,
  getOrderCostTruth,
  _splitRealRows,
};
