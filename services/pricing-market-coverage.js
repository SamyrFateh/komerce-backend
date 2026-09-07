/**
 * @komerce-arch
 * @role          economic-engine-pricing-market-coverage
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        market_id, canonical_period_bounds, coverage_policy, disposition_policy, allocation_policies, risk_reconciliation
 * @outputs       market_coverage_truth
 * @depends       db, services/pricing-maturity.js, services/pricing-period-structure.js, services/cost-allocation/cost-types.js
 * @used-by       future pricing strategy gate, pricing workspace
 * @db-read       orders, order_item_cost_imputations, order_item_real_cost_allocations
 * @db-write      none
 * @db-txn        none
 * @doctrine      pricing_market_viability_coverage
 * @impact-areas  economic-engine, pricing, governance
 * @version       2026-09
 */

/**
 * KOMERCE — Couverture économique par marché
 * ════════════════════════════════════════════════════════════════════════
 *
 * Invariants :
 * - le gate est par market_id ; le groupe ne masque jamais un marché ;
 * - numérateur et dénominateur portent sur la même fenêtre canonique ;
 * - seules les commandes MATURE contribuent au numérateur ;
 * - une disposition peut faire avancer le watermark mais ne fabrique jamais
 *   une contribution réelle ;
 * - N3 vient exclusivement de la vérité de période + allocation GROUP ;
 * - la provision risque estimée reste provisoire. Si elle existe et qu'aucune
 *   réconciliation de période explicite n'est fournie, le gate reste
 *   NOT_DECISIONAL ;
 * - seuils, fenêtre, dispositions et allocations sont fournis par politiques
 *   externes versionnées : aucun chiffre autorisant n'est hardcodé ici ;
 * - ce service n'applique aucun prix et n'écrit aucune stratégie.
 */

'use strict';

const db = require('../db');
const { computeMarketMaturityWatermark } = require('./pricing-maturity');
const { computePeriodStructureTruth } = require('./pricing-period-structure');
const {
  RECONCILIABLE_VARIABLE_COST_TYPES,
  N2_PROVISION_COST_TYPES,
} = require('./cost-allocation/cost-types');

const COVERAGE_STATUSES = Object.freeze({
  COVERED: 'COVERED',
  UNCOVERED: 'UNCOVERED',
  NOT_DECISIONAL: 'NOT_DECISIONAL',
});

const DISPOSED_TREATMENTS = Object.freeze({
  EXCLUDE_FROM_NUMERATOR: 'EXCLUDE_FROM_NUMERATOR',
});

function finiteNumber(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a finite number`);
  return parsed;
}

function requiredText(value, field, min = 1, max = 1000) {
  const text = String(value || '').trim();
  if (text.length < min || text.length > max) {
    throw new Error(`${field} length must be between ${min} and ${max}`);
  }
  return text;
}

function parsePeriod(fromValue, toValue) {
  const from = new Date(fromValue);
  const to = new Date(toValue);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
    throw new Error('canonical coverage bounds are invalid');
  }
  return { from, to };
}

function normalizeCoveragePolicy(policy, period) {
  if (!policy || typeof policy !== 'object') throw new Error('coverage policy must be an object');

  const version = requiredText(policy.version, 'coverage_policy.version', 1, 100);
  const source = requiredText(policy.source, 'coverage_policy.source', 3, 500);
  const evidenceRef = requiredText(policy.evidence_ref, 'coverage_policy.evidence_ref', 3, 1000);
  const maturityThreshold = finiteNumber(policy.maturity_threshold, 'coverage_policy.maturity_threshold');
  const coverageThreshold = finiteNumber(policy.coverage_threshold, 'coverage_policy.coverage_threshold');
  const disposedTreatment = String(policy.disposed_contribution_treatment || '').trim().toUpperCase();

  if (maturityThreshold < 0 || maturityThreshold > 1) {
    throw new Error('coverage policy maturity_threshold must be between 0 and 1');
  }
  if (!(coverageThreshold > 0)) {
    throw new Error('coverage policy coverage_threshold must be > 0');
  }
  if (!Object.values(DISPOSED_TREATMENTS).includes(disposedTreatment)) {
    throw new Error('coverage policy disposed_contribution_treatment must be EXCLUDE_FROM_NUMERATOR');
  }

  const effectiveFrom = new Date(policy.effective_from);
  const effectiveTo = policy.effective_to == null ? null : new Date(policy.effective_to);
  if (!Number.isFinite(effectiveFrom.getTime())) throw new Error('coverage policy effective_from is invalid');
  if (effectiveTo && (!Number.isFinite(effectiveTo.getTime()) || effectiveTo <= effectiveFrom)) {
    throw new Error('coverage policy effective_to is invalid');
  }

  const coversPeriod = effectiveFrom <= period.from && (!effectiveTo || effectiveTo >= period.to);
  if (!coversPeriod) throw new Error('coverage policy does not cover canonical period');

  return {
    version,
    source,
    evidence_ref: evidenceRef,
    maturity_threshold: maturityThreshold,
    coverage_threshold: coverageThreshold,
    disposed_contribution_treatment: disposedTreatment,
    effective_from: effectiveFrom.toISOString(),
    effective_to: effectiveTo ? effectiveTo.toISOString() : null,
    covers_period: true,
  };
}

function normalizeRiskReconciliation(input, marketId, period) {
  if (!input || typeof input !== 'object') return null;

  const status = String(input.status || '').trim().toUpperCase();
  const inputMarketId = String(input.market_id || '').trim();
  const from = new Date(input.from);
  const to = new Date(input.to);
  const actualRiskCostKmf = finiteNumber(input.actual_risk_cost_kmf, 'risk_reconciliation.actual_risk_cost_kmf');
  const source = requiredText(input.source, 'risk_reconciliation.source', 3, 500);
  const version = requiredText(input.version, 'risk_reconciliation.version', 1, 100);
  const evidenceRef = requiredText(input.evidence_ref, 'risk_reconciliation.evidence_ref', 3, 1000);

  if (status !== 'RECONCILED') throw new Error('risk reconciliation status must be RECONCILED');
  if (inputMarketId !== String(marketId)) throw new Error('risk reconciliation market_id mismatch');
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    throw new Error('risk reconciliation bounds are invalid');
  }
  if (from.getTime() !== period.from.getTime() || to.getTime() !== period.to.getTime()) {
    throw new Error('risk reconciliation must use the exact canonical period');
  }
  if (actualRiskCostKmf < 0) throw new Error('risk reconciliation actual_risk_cost_kmf must be >= 0');

  return {
    status: 'RECONCILED',
    market_id: inputMarketId,
    from: from.toISOString(),
    to: to.toISOString(),
    actual_risk_cost_kmf: actualRiskCostKmf,
    source,
    version,
    evidence_ref: evidenceRef,
  };
}

function roundKmf(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

async function loadMatureContributionTruth(marketId, period, matureOrderIds) {
  if (!matureOrderIds.length) {
    return {
      mature_order_count: 0,
      revenue_kmf: 0,
      transaction_variable_cost_kmf: 0,
      estimated_risk_provision_kmf: 0,
      contribution_before_risk_kmf: 0,
      provisional_contribution_after_estimated_risk_kmf: 0,
      unknown_actual_cost_kmf: 0,
    };
  }

  const { rows } = await db.query(
    `WITH scoped_orders AS (
       SELECT o.id, o.total_kmf
         FROM orders o
        WHERE o.market_id = $1
          AND o.created_at >= $2
          AND o.created_at < $3
          AND o.id = ANY($4::uuid[])
          AND o.payment_status = 'paid'
          AND COALESCE(o.status, '') NOT IN ('cancelled', 'refunded')
     ),
     actual_costs AS (
       SELECT
         COALESCE(SUM(alc.amount_kmf) FILTER (
           WHERE alc.cost_type = ANY($5::text[])
             AND alc.is_actual = TRUE
             AND alc.allocation_method <> 'estimated_fallback'
         ), 0) AS transaction_variable_kmf,
         COALESCE(SUM(alc.amount_kmf) FILTER (
           WHERE NOT (alc.cost_type = ANY($5::text[]))
             AND NOT (alc.cost_type = ANY($6::text[]))
             AND alc.cost_type <> 'fixed_overhead'
         ), 0) AS unknown_actual_kmf
       FROM order_item_real_cost_allocations alc
       JOIN scoped_orders so ON so.id = alc.order_id
     ),
     risk_estimate AS (
       SELECT COALESCE(SUM(
         COALESCE((imp.cost_breakdown->'business'->>'risk_provision')::numeric, 0)
       ), 0) AS estimated_risk_kmf
       FROM order_item_cost_imputations imp
       JOIN scoped_orders so ON so.id = imp.order_id
     )
     SELECT
       COUNT(*)::int AS mature_order_count,
       COALESCE(SUM(so.total_kmf), 0) AS revenue_kmf,
       ac.transaction_variable_kmf,
       ac.unknown_actual_kmf,
       re.estimated_risk_kmf
     FROM scoped_orders so
     CROSS JOIN actual_costs ac
     CROSS JOIN risk_estimate re
     GROUP BY ac.transaction_variable_kmf, ac.unknown_actual_kmf, re.estimated_risk_kmf`,
    [
      marketId,
      period.from.toISOString(),
      period.to.toISOString(),
      matureOrderIds,
      RECONCILIABLE_VARIABLE_COST_TYPES,
      N2_PROVISION_COST_TYPES,
    ]
  );

  const row = rows[0] || {};
  const revenue = Number(row.revenue_kmf) || 0;
  const transactionVariable = Number(row.transaction_variable_kmf) || 0;
  const estimatedRisk = Number(row.estimated_risk_kmf) || 0;
  const unknownActual = Number(row.unknown_actual_kmf) || 0;
  const beforeRisk = revenue - transactionVariable;

  return {
    mature_order_count: Number(row.mature_order_count) || 0,
    revenue_kmf: roundKmf(revenue),
    transaction_variable_cost_kmf: roundKmf(transactionVariable),
    estimated_risk_provision_kmf: roundKmf(estimatedRisk),
    contribution_before_risk_kmf: roundKmf(beforeRisk),
    provisional_contribution_after_estimated_risk_kmf: roundKmf(beforeRisk - estimatedRisk),
    unknown_actual_cost_kmf: roundKmf(unknownActual),
  };
}

function notDecisional(base, reason, details = {}) {
  return {
    ...base,
    coverage_status: COVERAGE_STATUSES.NOT_DECISIONAL,
    coverage_ratio: null,
    authorization: 'DENY_NEW_UNDER_CDR_POSITION',
    reason,
    ...details,
  };
}

async function computeMarketCoverage(options = {}) {
  const marketId = String(options.marketId || '').trim();
  if (!marketId) throw new Error('marketId is required');
  const period = parsePeriod(options.from, options.to);
  const policy = normalizeCoveragePolicy(options.coveragePolicy, period);

  const maturity = await computeMarketMaturityWatermark(marketId, {
    from: period.from.toISOString(),
    to: period.to.toISOString(),
    dispositionPolicy: options.dispositionPolicy || null,
  });

  const structure = await computePeriodStructureTruth({
    from: period.from.toISOString(),
    to: period.to.toISOString(),
    marketId,
    allocationPolicies: options.allocationPolicies,
  });

  const matureOrderIds = Array.isArray(maturity.mature_order_ids)
    ? maturity.mature_order_ids.map(String)
    : [];
  const contribution = await loadMatureContributionTruth(marketId, period, matureOrderIds);

  const base = {
    market_id: marketId,
    period: { from: period.from.toISOString(), to: period.to.toISOString(), bounds: '[from,to)' },
    policy,
    maturity,
    structure,
    contribution,
    risk_reconciliation: null,
  };

  if (!Array.isArray(maturity.mature_order_ids)) {
    return notDecisional(base, 'MATURE_ORDER_IDS_NOT_EXPOSED');
  }
  if (maturity.decision_status !== 'READY_FOR_NEXT_GATE') {
    return notDecisional(base, 'MATURITY_WATERMARK_NOT_READY');
  }
  if (maturity.maturity_ratio == null || maturity.maturity_ratio < policy.maturity_threshold) {
    return notDecisional(base, 'MATURITY_THRESHOLD_NOT_MET');
  }
  if (!structure.market_n3_decisional || structure.market_n3_total_kmf == null) {
    return notDecisional(base, 'MARKET_N3_NOT_DECISIONAL');
  }
  if (contribution.mature_order_count !== maturity.mature_orders) {
    return notDecisional(base, 'MATURE_ORDER_SET_MISMATCH');
  }
  if (contribution.unknown_actual_cost_kmf !== 0) {
    return notDecisional(base, 'UNKNOWN_ACTUAL_VARIABLE_COST_TYPE');
  }

  const risk = normalizeRiskReconciliation(options.riskReconciliation, marketId, period);
  if (contribution.estimated_risk_provision_kmf > 0 && !risk) {
    return notDecisional(base, 'RISK_RECONCILIATION_REQUIRED', {
      risk_reconciliation: { status: 'PENDING_PERIOD_TRUTH' },
    });
  }

  const actualRiskCost = risk ? risk.actual_risk_cost_kmf : 0;
  const reconciledContribution = roundKmf(contribution.contribution_before_risk_kmf - actualRiskCost);
  const n3 = Number(structure.market_n3_total_kmf);
  const enrichedBase = {
    ...base,
    risk_reconciliation: risk || { status: 'NOT_APPLICABLE', actual_risk_cost_kmf: 0 },
    contribution: {
      ...contribution,
      reconciled_risk_cost_kmf: roundKmf(actualRiskCost),
      reconciled_contribution_kmf: reconciledContribution,
      risk_variance_vs_provision_kmf: roundKmf(actualRiskCost - contribution.estimated_risk_provision_kmf),
    },
  };

  if (!(n3 > 0)) {
    return notDecisional(enrichedBase, 'NON_POSITIVE_MARKET_N3');
  }

  const ratio = Number((reconciledContribution / n3).toFixed(6));
  const covered = ratio >= policy.coverage_threshold;

  return {
    ...enrichedBase,
    coverage_status: covered ? COVERAGE_STATUSES.COVERED : COVERAGE_STATUSES.UNCOVERED,
    coverage_ratio: ratio,
    authorization: covered ? 'ALLOW_NEW_UNDER_CDR_POSITION' : 'DENY_NEW_UNDER_CDR_POSITION',
    reason: covered ? 'COVERAGE_THRESHOLD_MET' : 'COVERAGE_THRESHOLD_NOT_MET',
    denominator_n3_kmf: roundKmf(n3),
    numerator_contribution_kmf: reconciledContribution,
    threshold_applied: true,
  };
}

module.exports = {
  COVERAGE_STATUSES,
  DISPOSED_TREATMENTS,
  computeMarketCoverage,
  _normalizeCoveragePolicy: normalizeCoveragePolicy,
  _normalizeRiskReconciliation: normalizeRiskReconciliation,
  _loadMatureContributionTruth: loadMatureContributionTruth,
};
