/**
 * @komerce-arch
 * @role          economic-engine-pricing-market-decision-projection
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        canonical_market_decision
 * @outputs       enriched_market_decision_projection
 * @depends       services/pricing-market-decision-policy.js output contract
 * @used-by       routes/admin-pricing-workspace.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      one_contribution_many_views, contribution_covers_structural_charges_collectively, rolling_flow_cadence_is_projection_not_cost_truth
 * @impact-areas  economic-engine, pricing, admin-dashboard
 * @version       2026-09
 */

'use strict';

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 2) {
  const number = finite(value);
  if (number == null) return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function ceilEquivalent(targetKmf, contributionPerUnitKmf) {
  const target = finite(targetKmf);
  const productivity = finite(contributionPerUnitKmf);
  if (target == null || target < 0 || productivity == null || productivity <= 0) return null;
  return Math.ceil(target / productivity);
}

function ratePerDay(count, windowDays) {
  const value = finite(count);
  const days = finite(windowDays);
  if (value == null || days == null || days <= 0) return null;
  return round(value / days, 3);
}

function projectDays(gapKmf, contributionPerDayKmf) {
  const gap = finite(gapKmf);
  const velocity = finite(contributionPerDayKmf);
  if (gap == null || gap < 0) return null;
  if (gap === 0) return 0;
  if (velocity == null || velocity <= 0) return null;
  return round(gap / velocity, 1);
}

function enrichTarget(target, observedMix) {
  if (!target || !observedMix) return target || null;
  return {
    ...target,
    break_even_floor_orders: ceilEquivalent(target.target_contribution_kmf, observedMix.contribution_per_order_kmf),
    break_even_floor_articles: ceilEquivalent(target.target_contribution_kmf, observedMix.contribution_per_article_kmf),
    break_even_floor_parcels: ceilEquivalent(target.target_contribution_kmf, observedMix.contribution_per_parcel_kmf),
  };
}

function buildFlowVelocity(decision, observedMix, target) {
  const windowDays = finite(decision?.canonical_period?.width_days);
  if (windowDays == null || windowDays <= 0 || !observedMix) return null;

  const contribution = finite(observedMix.reconciled_contribution_kmf);
  const contributionPerDay = contribution == null ? null : round(contribution / windowDays, 2);

  return {
    basis: 'ROLLING_CANONICAL_WINDOW_AVERAGE',
    window_days: windowDays,
    articles_per_day: ratePerDay(observedMix.article_units, windowDays),
    orders_per_day: ratePerDay(observedMix.mature_orders, windowDays),
    parcels_per_day: ratePerDay(observedMix.parcels, windowDays),
    contribution_per_day_kmf: contributionPerDay,
    projected_days_to_break_even: projectDays(target?.gap_kmf, contributionPerDay),
    interpretation: 'Smoothed operational cadence over the canonical rolling window; one contribution pool, several flow views.',
  };
}

function decorateMarketDecision(decision) {
  if (!decision || typeof decision !== 'object') return decision;
  const flow = decision.flow_break_even;
  if (!flow || flow.status !== 'READY') return decision;

  const observedMix = flow.observed_mix || null;
  const economicBreakEven = enrichTarget(flow.economic_break_even, observedMix);
  const policySafetyTarget = enrichTarget(flow.policy_safety_target, observedMix);
  const contribution = finite(decision.coverage?.numerator_contribution_kmf ?? observedMix?.reconciled_contribution_kmf);
  // Compatibility read only: older coverage truth still exposes denominator_n3_kmf.
  // The canonical name is structural_charges_kmf.
  const structuralCharges = finite(
    decision.coverage?.structural_charges_kmf ?? decision.coverage?.denominator_n3_kmf
  );

  return {
    ...decision,
    coverage: decision.coverage
      ? { ...decision.coverage, structural_charges_kmf: structuralCharges }
      : decision.coverage,
    flow_break_even: {
      ...flow,
      economic_state: {
        period_contribution_kmf: contribution,
        period_structural_charges_kmf: structuralCharges,
        // Temporary compatibility alias for canonical UI consumers still being migrated.
        period_n3_kmf: structuralCharges,
        coverage_ratio: finite(decision.coverage?.coverage_ratio),
        break_even_gap_kmf: finite(economicBreakEven?.gap_kmf),
        period_result_kmf: contribution == null || structuralCharges == null
          ? null
          : round(contribution - structuralCharges, 2),
      },
      economic_break_even: economicBreakEven,
      policy_safety_target: policySafetyTarget,
      flow_velocity: buildFlowVelocity(decision, observedMix, economicBreakEven),
      contribution_identity: {
        source: 'ARTICLE_SALES_SINGLE_POOL',
        order_view: 'AGGREGATION_ONLY',
        parcel_view: 'AGGREGATION_ONLY',
        double_counting_forbidden: true,
      },
      structural_charge_identity: {
        scope: 'MARKET_PERIOD_PORTFOLIO',
        sku_debt: false,
        pricing_authority: 'NONE',
      },
    },
  };
}

module.exports = {
  decorateMarketDecision,
  _ceilEquivalent: ceilEquivalent,
  _buildFlowVelocity: buildFlowVelocity,
  _projectDays: projectDays,
};
