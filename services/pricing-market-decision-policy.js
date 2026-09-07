/**
 * @komerce-arch
 * @role          economic-engine-pricing-market-decision-policy
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        market_id, policy_event, evaluation_time, optional_group_allocation_policies
 * @outputs       append_only_policy_event, current_policy, canonical_market_decision
 * @depends       db, services/pricing-market-coverage.js
 * @used-by       routes/admin-pricing-workspace.js, services/market-local-price-activation-service.js
 * @db-read       markets, pricing_market_decision_policy_events
 * @db-write      pricing_market_decision_policy_events
 * @db-txn        append_only_policy_recording
 * @doctrine      pricing_market_viability_policy_is_explicit_versioned_and_market_scoped
 * @impact-areas  economic-engine, pricing, governance, admin-dashboard
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

async function evaluateMarketDecision(marketId, options = {}) {
  if (!marketId) throw new Error('marketId is required');
  const evaluationAt = parseInstant(options.at || new Date(), 'evaluation_at');
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
      evaluated_at: evaluationAt.toISOString(),
    };
  }

  const period = canonicalPeriod(policy, evaluationAt);
  const coverage = await computeMarketCoverage({
    marketId,
    from: period.from,
    to: period.to,
    coveragePolicy: coveragePolicyFrom(policy),
    dispositionPolicy: dispositionPolicyFrom(policy),
    allocationPolicies: options.allocationPolicies == null ? null : options.allocationPolicies,
  });

  return {
    market_id: marketId,
    decision_status: coverage.coverage_status,
    authorization: coverage.authorization,
    reason: coverage.reason,
    policy,
    canonical_period: period,
    coverage,
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
  coveragePolicyFrom,
  dispositionPolicyFrom,
  evaluateMarketDecision,
};
