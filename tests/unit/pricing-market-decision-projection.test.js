'use strict';

const {
  decorateMarketDecision,
  _buildFlowVelocity,
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
