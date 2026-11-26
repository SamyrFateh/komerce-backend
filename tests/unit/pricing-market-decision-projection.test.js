/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

const {
  decorateMarketDecision,
  _buildFlowVelocity,
  projectPeriodDecisionEvidence,
} = require('../../services/pricing-market-decision-projection');

test('enrichit le même pool de contribution avec charges structurelles et seuils équivalents sans double comptage', () => {
  const decision = {
    canonical_period: { width_days: 30 },
    coverage: {
      coverage_ratio: 0.72,
      numerator_contribution_kmf: 720,
      // Alias technique legacy accepté à l’entrée seulement.
      denominator_n3_kmf: 1000,
    },
    flow_break_even: {
      status: 'READY',
      observed_mix: {
        mature_orders: 4,
        article_units: 10,
        parcels: 2,
        reconciled_contribution_kmf: 720,
        contribution_per_order_kmf: 180,
        contribution_per_article_kmf: 72,
        contribution_per_parcel_kmf: 360,
      },
      economic_break_even: {
        target_coverage_ratio: 1,
        target_contribution_kmf: 1000,
        gap_kmf: 280,
        additional_equivalent_orders: 2,
        additional_equivalent_articles: 4,
        additional_equivalent_parcels: 1,
      },
      policy_safety_target: {
        target_coverage_ratio: 1.1,
        target_contribution_kmf: 1100,
        gap_kmf: 380,
      },
    },
  };

  const result = decorateMarketDecision(decision);
  const flow = result.flow_break_even;

  expect(result.coverage.structural_charges_kmf).toBe(1000);
  expect(flow.economic_state).toMatchObject({
    period_contribution_kmf: 720,
    period_structural_charges_kmf: 1000,
    period_n3_kmf: 1000,
    coverage_ratio: 0.72,
    break_even_gap_kmf: 280,
    period_result_kmf: -280,
  });
  expect(flow.economic_break_even).toMatchObject({
    break_even_floor_orders: 6,
    break_even_floor_articles: 14,
    break_even_floor_parcels: 3,
  });
  expect(flow.policy_safety_target).toMatchObject({
    break_even_floor_orders: 7,
    break_even_floor_articles: 16,
    break_even_floor_parcels: 4,
  });
  expect(flow.contribution_identity).toEqual({
    source: 'ARTICLE_SALES_SINGLE_POOL',
    order_view: 'AGGREGATION_ONLY',
    parcel_view: 'AGGREGATION_ONLY',
    double_counting_forbidden: true,
  });
  expect(flow.structural_charge_identity).toEqual({
    scope: 'MARKET_PERIOD_PORTFOLIO',
    sku_debt: false,
    pricing_authority: 'NONE',
  });
});

test('cadence lissée utilise la fenêtre canonique et converge vers une seule durée économique', () => {
  const velocity = _buildFlowVelocity(
    { canonical_period: { width_days: 30 } },
    {
      mature_orders: 90,
      article_units: 300,
      parcels: 60,
      reconciled_contribution_kmf: 900000,
    },
    { gap_kmf: 300000 }
  );

  expect(velocity).toMatchObject({
    basis: 'ROLLING_CANONICAL_WINDOW_AVERAGE',
    window_days: 30,
    articles_per_day: 10,
    orders_per_day: 3,
    parcels_per_day: 2,
    contribution_per_day_kmf: 30000,
    projected_days_to_break_even: 10,
  });
});

test('cadence lissée sur un mois calendaire porte un basis distinct de la fenêtre glissante', () => {
  const velocity = _buildFlowVelocity(
    { canonical_period: { width_days: 30, source: 'calendar_month_selection' } },
    {
      mature_orders: 90,
      article_units: 300,
      parcels: 60,
      reconciled_contribution_kmf: 900000,
    },
    { gap_kmf: 300000 }
  );

  expect(velocity.basis).toBe('CALENDAR_MONTH_AVERAGE');
  expect(velocity.window_days).toBe(30);
});

test('ne fabrique pas de cadence ou de durée lorsque le flux ne converge pas', () => {
  const velocity = _buildFlowVelocity(
    { canonical_period: { width_days: 30 } },
    {
      mature_orders: 10,
      article_units: 20,
      parcels: 8,
      reconciled_contribution_kmf: -100,
    },
    { gap_kmf: 500 }
  );

  expect(velocity.contribution_per_day_kmf).toBeLessThan(0);
  expect(velocity.projected_days_to_break_even).toBeNull();
});


test('données économiques absentes ou vides : jamais converties en zéro ni en résultat certifié', () => {
  const projected = decorateMarketDecision({
    canonical_period: { width_days: 30 },
    coverage: {
      numerator_contribution_kmf: null,
      structural_charges_kmf: '',
      coverage_ratio: null,
    },
    flow_break_even: {
      status: 'READY',
      observed_mix: {
        reconciled_contribution_kmf: null,
        contribution_per_article_kmf: null,
      },
      economic_break_even: {
        target_contribution_kmf: null,
        gap_kmf: null,
      },
    },
  });
  const state = projected.flow_break_even.economic_state;
  expect(state.period_contribution_kmf).toBeNull();
  expect(state.period_structural_charges_kmf).toBeNull();
  expect(state.period_result_kmf).toBeNull();
  expect(state.coverage_ratio).toBeNull();
  expect(state.break_even_gap_kmf).toBeNull();
  expect(projected.flow_break_even.flow_velocity.contribution_per_day_kmf).toBeNull();
  expect(projected.flow_break_even.flow_velocity.projected_days_to_break_even).toBeNull();
});

test('zéro explicite est conservé, et résultat négatif calculé uniquement si charges connues', () => {
  const projected = decorateMarketDecision({
    coverage: {
      numerator_contribution_kmf: 0,
      structural_charges_kmf: 1200,
    },
    flow_break_even: { status: 'READY', observed_mix: {}, economic_break_even: {} },
  });
  expect(projected.flow_break_even.economic_state).toMatchObject({
    period_contribution_kmf: 0,
    period_structural_charges_kmf: 1200,
    period_result_kmf: -1200,
  });
  expect(projected.coverage.structural_charges_kmf).toBe(1200);
});

test('V6 canonical decision evidence stays separate and requires exact scope, period and gate',()=>{
 const period={from:'2026-01-01T00:00:00.000Z',to:'2026-02-01T00:00:00.000Z',source:'calendar_month_selection',width_days:31};
 const d={market_id:'M',canonical_period:period,decision_status:'UNCOVERED',coverage:{market_id:'M',period,coverage_status:'UNCOVERED',threshold_applied:true,numerator_contribution_kmf:720,denominator_n3_kmf:1000,coverage_ratio:0.72,contribution:{mature_order_count:4,revenue_kmf:2000,transaction_variable_cost_kmf:1200,reconciled_risk_cost_kmf:80}},flow_break_even:{status:'READY',observed_mix:{},economic_break_even:{gap_kmf:280}}};
 const p=projectPeriodDecisionEvidence(decorateMarketDecision(d),'M','2026-01-01');
 expect(p).toMatchObject({status:'AVAILABLE_ON_MATURE_COHORT',fullEconomicResult:false,contributionKmf:'720.00',structureKmf:'1000.00',resultKmf:'-280.00',remainingKmf:'280.00',coverageRatio:'0.72',matureOrderCount:4,actualRiskKmf:'80.00'});
 expect(projectPeriodDecisionEvidence(d,'OTHER','2026-01-01')).toMatchObject({status:'NOT_DECISIONAL',reason:'DECISION_SCOPE_MISMATCH',resultKmf:null});
 expect(projectPeriodDecisionEvidence(d,'M','2026-02-01')).toMatchObject({status:'NOT_DECISIONAL',reason:'DECISION_SCOPE_MISMATCH',resultKmf:null});
 expect(projectPeriodDecisionEvidence({...d,coverage:{...d.coverage,threshold_applied:false}},'M','2026-01-01')).toMatchObject({status:'NOT_DECISIONAL',contributionKmf:null});
 expect(projectPeriodDecisionEvidence({...d,canonical_period:null,reason:'MARKET_DECISION_POLICY_REQUIRED'},'M','2026-01-01')).toMatchObject({status:'NOT_DECISIONAL',reason:'MARKET_DECISION_POLICY_REQUIRED'});
 expect(projectPeriodDecisionEvidence({...d,flow_break_even:null},'M','2026-01-01')).toMatchObject({status:'AVAILABLE_ON_MATURE_COHORT',resultKmf:null,remainingKmf:null});
});
