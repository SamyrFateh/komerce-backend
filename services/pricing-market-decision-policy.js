/**
 * @komerce-arch
 * @role          economic-engine-pricing-market-decision-policy
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        market_id, policy_event, evaluation_time, optional_group_allocation_policies
 * @outputs       append_only_policy_event, current_policy, canonical_market_decision, flow_break_even_projection
 * @depends       db, services/pricing-market-coverage.js
 * @used-by       routes/admin-pricing-workspace.js
 * @db-read       markets, pricing_market_decision_policy_events, order_items, parcels
 * @db-write      pricing_market_decision_policy_events
 * @db-txn        append_only_policy_recording
 * @doctrine      pricing_market_viability_policy_is_explicit_versioned_and_market_scoped, pricing_flow_break_even_is_projection_not_cost_truth
 * @impact-areas  economic-engine, pricing, governance, admin-dashboard, operational-flow
 * @version       2026-09
 */

'use strict';

const db = require('../db');
const { computeMarketCoverage } = require('./pricing-market-coverage');

const DISPOSED_TREATMENT = 'EXCLUDE_FROM_NUMERATOR';

function requiredText(value, field, min = 1, max = 2000) {
  const text = String(value || '').trim();
  if (text.length < min || text.length > max) {
    throw new Error(`${field} length must be between ${min} and ${max}`);
  }
  return text;
}

function finiteNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${field} must be a finite number`);
  return number;
}

function parseInstant(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${field} is invalid`);
  return date;
}

function normalizePolicyInput(input = {}, actorId, options = {}) {
  if (!actorId) throw new Error('policy actor is required');

  const now = parseInstant(options.now || new Date(), 'now');
  const version = requiredText(input.version, 'policy.version', 1, 100);
  const windowDays = finiteNumber(input.window_days, 'policy.window_days');
  const maturityThreshold = finiteNumber(input.maturity_threshold, 'policy.maturity_threshold');
  const coverageThreshold = finiteNumber(input.coverage_threshold, 'policy.coverage_threshold');
  const maxDispositionRatio = finiteNumber(input.max_disposition_ratio, 'policy.max_disposition_ratio');
  const source = requiredText(input.source, 'policy.source', 3, 500);
  const evidenceRef = requiredText(input.evidence_ref, 'policy.evidence_ref', 3, 1000);
  const rationale = requiredText(input.rationale, 'policy.rationale', 10, 2000);

  if (!Number.isInteger(windowDays) || windowDays <= 0) {
    throw new Error('policy.window_days must be a positive integer');
  }
  if (maturityThreshold < 0 || maturityThreshold > 1) {
    throw new Error('policy.maturity_threshold must be between 0 and 1');
  }
  if (!(coverageThreshold > 0)) {
    throw new Error('policy.coverage_threshold must be > 0');
  }
  if (maxDispositionRatio < 0 || maxDispositionRatio > 1) {
    throw new Error('policy.max_disposition_ratio must be between 0 and 1');
  }

  const treatment = String(input.disposed_contribution_treatment || DISPOSED_TREATMENT)
    .trim()
    .toUpperCase();
  if (treatment !== DISPOSED_TREATMENT) {
    throw new Error(`policy.disposed_contribution_treatment must be ${DISPOSED_TREATMENT}`);
  }

  const effectiveFrom = input.effective_from == null
    ? now
    : parseInstant(input.effective_from, 'policy.effective_from');
  const effectiveTo = input.effective_to == null
    ? null
    : parseInstant(input.effective_to, 'policy.effective_to');

  // Le navigateur peut planifier une politique future mais ne réécrit jamais
  // rétroactivement la règle qui aurait gouverné une décision déjà prise.
  if (effectiveFrom.getTime() < now.getTime()) {
    throw new Error('policy.effective_from cannot be backdated');
  }
  if (effectiveTo && effectiveTo <= effectiveFrom) {
    throw new Error('policy.effective_to must be after effective_from');
  }

  return {
    version,
    window_days: windowDays,
    maturity_threshold: maturityThreshold,
    coverage_threshold: coverageThreshold,
    max_disposition_ratio: maxDispositionRatio,
    disposed_contribution_treatment: treatment,
    effective_from: effectiveFrom.toISOString(),
    effective_to: effectiveTo ? effectiveTo.toISOString() : null,
    source,
    evidence_ref: evidenceRef,
    rationale,
  };
}

function publicPolicy(row) {
  if (!row) return null;
  return {
    version: row.version,
    window_days: Number(row.window_days),
    maturity_threshold: Number(row.maturity_threshold),
    coverage_threshold: Number(row.coverage_threshold),
    max_disposition_ratio: Number(row.max_disposition_ratio),
    disposed_contribution_treatment: row.disposed_contribution_treatment,
    effective_from: row.effective_from,
    effective_to: row.effective_to,
    source: row.source,
    evidence_ref: row.evidence_ref,
    rationale: row.rationale,
    recorded_at: row.recorded_at,
  };
}

async function recordMarketDecisionPolicy(marketId, input = {}, actorId, options = {}) {
  if (!marketId) throw new Error('marketId is required');
  const policy = normalizePolicyInput(input, actorId, options);
  const client = await db.getClient();

  try {
    await client.query('BEGIN');
    const marketRes = await client.query(
      'SELECT id FROM markets WHERE id = $1 AND is_active = TRUE FOR UPDATE',
      [marketId]
    );
    if (!marketRes.rows.length) throw new Error('market not found or inactive');

    const insertRes = await client.query(`
      INSERT INTO pricing_market_decision_policy_events (
        market_id, version, window_days,
        maturity_threshold, coverage_threshold, max_disposition_ratio,
        disposed_contribution_treatment,
        effective_from, effective_to,
        source, evidence_ref, rationale, recorded_by
      ) VALUES (
        $1, $2, $3,
        $4, $5, $6,
        $7,
        $8, $9,
        $10, $11, $12, $13
      )
      RETURNING version, window_days, maturity_threshold, coverage_threshold,
                max_disposition_ratio, disposed_contribution_treatment,
                effective_from, effective_to, source, evidence_ref, rationale,
                recorded_at
    `, [
      marketId,
      policy.version,
      policy.window_days,
      policy.maturity_threshold,
      policy.coverage_threshold,
      policy.max_disposition_ratio,
      policy.disposed_contribution_treatment,
      policy.effective_from,
      policy.effective_to,
      policy.source,
      policy.evidence_ref,
      policy.rationale,
      actorId,
    ]);

    await client.query('COMMIT');
    return publicPolicy(insertRes.rows[0]);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}

async function getCurrentMarketDecisionPolicy(marketId, options = {}) {
  if (!marketId) throw new Error('marketId is required');
  const at = parseInstant(options.at || new Date(), 'at').toISOString();
  const { rows } = await db.query(`
    SELECT version, window_days, maturity_threshold, coverage_threshold,
           max_disposition_ratio, disposed_contribution_treatment,
           effective_from, effective_to, source, evidence_ref, rationale,
           recorded_at
      FROM pricing_market_decision_policy_events
     WHERE market_id = $1
       AND effective_from <= $2
       AND (effective_to IS NULL OR effective_to > $2)
     ORDER BY effective_from DESC, recorded_at DESC, id DESC
     LIMIT 1
  `, [marketId, at]);
  return publicPolicy(rows[0] || null);
}

async function listMarketDecisionPolicyHistory(marketId, options = {}) {
  if (!marketId) throw new Error('marketId is required');
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100);
  const { rows } = await db.query(`
    SELECT version, window_days, maturity_threshold, coverage_threshold,
           max_disposition_ratio, disposed_contribution_treatment,
           effective_from, effective_to, source, evidence_ref, rationale,
           recorded_at
      FROM pricing_market_decision_policy_events
     WHERE market_id = $1
     ORDER BY effective_from DESC, recorded_at DESC, id DESC
     LIMIT $2
  `, [marketId, limit]);
  return rows.map(publicPolicy);
}

function canonicalPeriod(policy, atValue = new Date()) {
  if (!policy) throw new Error('market decision policy is required');
  const to = parseInstant(atValue, 'evaluation_at');
  const from = new Date(to.getTime() - (Number(policy.window_days) * 86400000));
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    bounds: '[from,to)',
    width_days: Number(policy.window_days),
    source: 'server_policy_window',
  };
}

const CALENDAR_MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

function parseCalendarMonth(yearMonth) {
  const match = CALENDAR_MONTH_PATTERN.exec(String(yearMonth || '').trim());
  if (!match) throw new Error('period must match YYYY-MM');
  return { year: Number(match[1]), month: Number(match[2]) };
}

function isValidCalendarMonth(yearMonth) {
  return CALENDAR_MONTH_PATTERN.test(String(yearMonth || '').trim());
}

// Résout un mois calendaire explicite ([from,to) en UTC) plutôt que la fenêtre
// glissante de policy.window_days. Le moteur de couverture (computeMarketCoverage)
// est agnostique à la largeur de la période : ce mode ne recalcule rien de la
// vérité économique, il ne fait que borner la période sur des frontières de mois
// civil au lieu d'un nombre de jours glissant. width_days varie donc avec le mois
// (28 à 31) — c'est intentionnel et reflète honnêtement la borne demandée.
function calendarMonthPeriod(yearMonth) {
  const { year, month } = parseCalendarMonth(yearMonth);
  const from = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const widthDays = Math.round((to.getTime() - from.getTime()) / 86400000);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    bounds: '[from,to)',
    width_days: widthDays,
    source: 'calendar_month_selection',
    calendar_month: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`,
  };
}

function coveragePolicyFrom(policy) {
  return {
    version: policy.version,
    source: policy.source,
    evidence_ref: policy.evidence_ref,
    maturity_threshold: policy.maturity_threshold,
    coverage_threshold: policy.coverage_threshold,
    disposed_contribution_treatment: policy.disposed_contribution_treatment,
    effective_from: policy.effective_from,
    effective_to: policy.effective_to,
  };
}

function dispositionPolicyFrom(policy) {
  return {
    version: policy.version,
    source: policy.source,
    max_ratio: policy.max_disposition_ratio,
  };
}

function roundProjection(value, digits = 6) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function positiveAverage(totalContribution, unitCount) {
  const total = Number(totalContribution);
  const count = Number(unitCount);
  if (!Number.isFinite(total) || !Number.isFinite(count) || count <= 0) return null;
  return roundProjection(total / count, 2);
}

function projectEquivalentUnits(gapKmf, contributionPerUnitKmf) {
  const gap = Number(gapKmf);
  const productivity = Number(contributionPerUnitKmf);
  if (!Number.isFinite(gap) || gap < 0) return null;
  if (gap === 0) return 0;
  if (!Number.isFinite(productivity) || productivity <= 0) return null;
  return Math.ceil(gap / productivity);
}

function buildBreakEvenTarget(targetCoverageRatio, n3Kmf, contributionKmf, productivity) {
  const target = Number(targetCoverageRatio);
  const n3 = Number(n3Kmf);
  const contribution = Number(contributionKmf);
  if (!(target > 0) || !(n3 > 0) || !Number.isFinite(contribution)) return null;

  const targetContribution = roundProjection(n3 * target, 2);
  const gap = roundProjection(Math.max(0, targetContribution - contribution), 2);
  const reached = gap === 0;
  const currentMixConverges = reached || Number(productivity.contribution_per_order_kmf) > 0;

  return {
    target_coverage_ratio: roundProjection(target),
    target_contribution_kmf: targetContribution,
    gap_kmf: gap,
    status: reached
      ? 'TARGET_REACHED'
      : (currentMixConverges ? 'CURRENT_MIX_PROJECTABLE' : 'CURRENT_MIX_NOT_PROJECTABLE'),
    additional_equivalent_orders: projectEquivalentUnits(gap, productivity.contribution_per_order_kmf),
    additional_equivalent_articles: projectEquivalentUnits(gap, productivity.contribution_per_article_kmf),
    additional_equivalent_parcels: projectEquivalentUnits(gap, productivity.contribution_per_parcel_kmf),
  };
}

async function loadObservedFlowShape(matureOrderIds) {
  if (!Array.isArray(matureOrderIds) || !matureOrderIds.length) {
    return { article_units: 0, parcel_count: 0 };
  }

  const { rows } = await db.query(`
    WITH scoped_orders AS (
      SELECT unnest($1::uuid[]) AS order_id
    ),
    item_shape AS (
      SELECT COALESCE(SUM(GREATEST(COALESCE(oi.quantity, 1), 0)), 0)::numeric AS article_units
        FROM order_items oi
        JOIN scoped_orders so ON so.order_id = oi.order_id
    ),
    parcel_shape AS (
      SELECT COUNT(DISTINCT p.id)::int AS parcel_count
        FROM parcels p
        JOIN scoped_orders so ON so.order_id = p.order_id
    )
    SELECT item_shape.article_units, parcel_shape.parcel_count
      FROM item_shape
      CROSS JOIN parcel_shape
  `, [matureOrderIds]);

  const row = rows[0] || {};
  return {
    article_units: Number(row.article_units) || 0,
    parcel_count: Number(row.parcel_count) || 0,
  };
}

async function computeFlowBreakEvenProjection(coverage, policy) {
  const base = {
    status: 'NOT_DECISIONAL',
    reason: 'COVERAGE_TRUTH_NOT_DECISIONAL',
    basis: 'CURRENT_RECONCILED_MIX',
    economic_break_even: null,
    policy_safety_target: null,
  };

  if (!coverage || !['COVERED', 'UNCOVERED'].includes(coverage.coverage_status)) return base;

  const n3 = Number(coverage.denominator_n3_kmf);
  const contribution = Number(coverage.numerator_contribution_kmf);
  if (!(n3 > 0) || !Number.isFinite(contribution)) {
    return { ...base, reason: 'BREAK_EVEN_INPUTS_UNAVAILABLE' };
  }

  const matureOrderIds = Array.isArray(coverage.mature_order_ids) ? coverage.mature_order_ids : [];
  const shape = await loadObservedFlowShape(matureOrderIds);
  const matureOrders = Number(coverage.contribution?.mature_order_count) || matureOrderIds.length;
  const articles = shape.article_units;
  const parcels = shape.parcel_count;

  const productivity = {
    contribution_per_order_kmf: positiveAverage(contribution, matureOrders),
    contribution_per_article_kmf: positiveAverage(contribution, articles),
    contribution_per_parcel_kmf: positiveAverage(contribution, parcels),
  };

  const observedMix = {
    mature_orders: matureOrders,
    article_units: articles,
    parcels,
    articles_per_order: matureOrders > 0 ? roundProjection(articles / matureOrders, 3) : null,
    articles_per_parcel: parcels > 0 ? roundProjection(articles / parcels, 3) : null,
    reconciled_contribution_kmf: roundProjection(contribution, 2),
    ...productivity,
  };

  return {
    status: 'READY',
    reason: 'CURRENT_RECONCILED_MIX_PROJECTED',
    basis: 'CURRENT_RECONCILED_MIX',
    observed_mix: observedMix,
    economic_break_even: buildBreakEvenTarget(1, n3, contribution, productivity),
    policy_safety_target: buildBreakEvenTarget(policy?.coverage_threshold, n3, contribution, productivity),
    assumptions: {
      structure_constant_within_projection: true,
      current_mix_constant: true,
      unmodelled_capacity_step_excluded: true,
    },
    interpretation: 'Equivalent operational units at the currently observed reconciled mix; not a sales forecast.',
  };
}

async function evaluateMarketDecision(marketId, options = {}) {
  if (!marketId) throw new Error('marketId is required');
  const useCalendarPeriod = options.period != null && String(options.period).trim() !== '';
  if (useCalendarPeriod && !isValidCalendarMonth(options.period)) {
    throw new Error('period must match YYYY-MM');
  }
  const calendarPeriod = useCalendarPeriod ? calendarMonthPeriod(options.period) : null;
  // Pour un mois calendaire explicite, on résout la politique en vigueur à la fin
  // de ce mois plutôt qu'à "maintenant" — cohérent avec l'idée qu'on évalue une
  // période passée avec la politique qui s'appliquait alors.
  const evaluationAt = parseInstant(calendarPeriod ? calendarPeriod.to : (options.at || new Date()), 'evaluation_at');
  const policy = await getCurrentMarketDecisionPolicy(marketId, { at: evaluationAt });

  if (!policy) {
    return {
      market_id: marketId,
      decision_status: 'NOT_DECISIONAL',
      authorization: 'DENY_NEW_UNDER_CDR_POSITION',
      reason: 'MARKET_DECISION_POLICY_REQUIRED',
      policy: null,
      canonical_period: null,
      coverage: null,
      flow_break_even: null,
      evaluated_at: evaluationAt.toISOString(),
    };
  }

  const period = calendarPeriod || canonicalPeriod(policy, evaluationAt);
  const coverage = await computeMarketCoverage({
    marketId,
    from: period.from,
    to: period.to,
    coveragePolicy: coveragePolicyFrom(policy),
    dispositionPolicy: dispositionPolicyFrom(policy),
    allocationPolicies: options.allocationPolicies == null ? null : options.allocationPolicies,
  });

  let flowBreakEven;
  try {
    flowBreakEven = await computeFlowBreakEvenProjection(coverage, policy);
  } catch (_) {
    // La projection de flux est explicative : une panne de lecture de forme du
    // flux ne doit jamais modifier l'autorisation canonique issue du gate.
    flowBreakEven = {
      status: 'NOT_AVAILABLE',
      reason: 'FLOW_SHAPE_READ_FAILED',
      basis: 'CURRENT_RECONCILED_MIX',
      economic_break_even: null,
      policy_safety_target: null,
    };
  }

  return {
    market_id: marketId,
    decision_status: coverage.coverage_status,
    authorization: coverage.authorization,
    reason: coverage.reason,
    policy,
    canonical_period: period,
    coverage,
    flow_break_even: flowBreakEven,
    evaluated_at: evaluationAt.toISOString(),
  };
}

module.exports = {
  DISPOSED_TREATMENT,
  normalizePolicyInput,
  recordMarketDecisionPolicy,
  getCurrentMarketDecisionPolicy,
  listMarketDecisionPolicyHistory,
  canonicalPeriod,
  calendarMonthPeriod,
  isValidCalendarMonth,
  coveragePolicyFrom,
  dispositionPolicyFrom,
  evaluateMarketDecision,
  _positiveAverage: positiveAverage,
  _projectEquivalentUnits: projectEquivalentUnits,
  _buildBreakEvenTarget: buildBreakEvenTarget,
  _loadObservedFlowShape: loadObservedFlowShape,
  _computeFlowBreakEvenProjection: computeFlowBreakEvenProjection,
};
