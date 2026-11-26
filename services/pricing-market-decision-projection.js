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
  // Number(null) and Number('') are zero: missing economic truth must stay unknown.
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
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

  const isCalendarPeriod = decision?.canonical_period?.source === 'calendar_month_selection';
  const contribution = finite(observedMix.reconciled_contribution_kmf);
  const contributionPerDay = contribution == null ? null : round(contribution / windowDays, 2);

  return {
    basis: isCalendarPeriod ? 'CALENDAR_MONTH_AVERAGE' : 'ROLLING_CANONICAL_WINDOW_AVERAGE',
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

// Read-only bridge to the existing market decision truth. This is a separate
// mature-order cohort evaluation, never a full result of the shipment cohort.
// Preserve the gate's refusals; do not turn a policy threshold into proof of
// complete commercial recognition or all-centers reconciliation.
function projectPeriodDecisionEvidence(decision,marketId,periodStart){
  const base={basis:'CANONICAL_MATURE_ORDER_PERIOD_DECISION',periodStart,
    evaluationSnapshot:'SEPARATE_CANONICAL_DECISION_READ',fullEconomicResult:false,
    status:'NOT_DECISIONAL',reason:'DECISION_UNAVAILABLE',contributionKmf:null,
    structureKmf:null,resultKmf:null,coverageRatio:null,remainingKmf:null,
    matureOrderCount:null,revenueBasisKmf:null,variableCostsKmf:null,actualRiskKmf:null};
  if(!decision)return base;
  if(decision.market_id!==marketId)return {...base,reason:'DECISION_SCOPE_MISMATCH'};
  if(!decision.canonical_period)return {...base,reason:decision.reason||'DECISION_PERIOD_UNAVAILABLE'};
  const start=new Date(periodStart+'T00:00:00.000Z'),end=new Date(start);end.setUTCMonth(end.getUTCMonth()+1);
  const c=decision.coverage,p=decision.canonical_period;
  const matches=x=>x?.from===start.toISOString()&&x?.to===end.toISOString();
  if(p.source!=='calendar_month_selection'||!matches(p)||c&&(c.market_id!==marketId||!matches(c.period)))
    return {...base,reason:'DECISION_SCOPE_MISMATCH'};
  if(!c||!['COVERED','UNCOVERED'].includes(decision.decision_status)||
    c.coverage_status!==decision.decision_status||c.threshold_applied!==true)
    return {...base,reason:decision.reason||c?.reason||'DECISION_NOT_READY'};
  const money=v=>{if(typeof v!=='number'||!Number.isFinite(v)||!Number.isSafeInteger(Math.round(v*100)))return null;return v.toFixed(2);};
  const contribution=money(c.numerator_contribution_kmf),structure=money(c.structural_charges_kmf??c.denominator_n3_kmf);
  const ratio=c.coverage_ratio;
  if(contribution===null||structure===null||Number(structure)<=0||typeof ratio!=='number'||!Number.isFinite(ratio))
    return {...base,reason:'DECISION_AMOUNTS_UNAVAILABLE'};
  const flow=decision.flow_break_even,es=flow?.economic_state;
  const cents=value=>BigInt(value.replace('.',''));
  const expectedResult=cents(contribution)-cents(structure);
  const expectedGap=expectedResult<0n?-expectedResult:0n;
  const storedResult=money(es?.period_result_kmf),storedGap=money(es?.break_even_gap_kmf);
  const matchingFlow=flow?.status==='READY'&&money(es?.period_contribution_kmf)===contribution&&money(es?.period_structural_charges_kmf)===structure;
  const result=matchingFlow&&storedResult!==null&&cents(storedResult)===expectedResult?storedResult:null;
  const gap=matchingFlow&&storedGap!==null&&cents(storedGap)===expectedGap?storedGap:null;
  return {...base,status:'AVAILABLE_ON_MATURE_COHORT',reason:null,gateStatus:decision.decision_status,
    evaluatedAt:decision.evaluated_at||null,contributionKmf:contribution,structureKmf:structure,resultKmf:result,remainingKmf:gap,
    coverageRatio:String(ratio),matureOrderCount:Number.isSafeInteger(c.contribution?.mature_order_count)?c.contribution.mature_order_count:null,
    revenueBasisKmf:money(c.contribution?.revenue_kmf),variableCostsKmf:money(c.contribution?.transaction_variable_cost_kmf),
    actualRiskKmf:money(c.contribution?.reconciled_risk_cost_kmf)};
}

module.exports = {
  projectPeriodDecisionEvidence,
  decorateMarketDecision,
  _ceilEquivalent: ceilEquivalent,
  _buildFlowVelocity: buildFlowVelocity,
  _projectDays: projectDays,
};
