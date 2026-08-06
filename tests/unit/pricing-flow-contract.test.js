/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * Tests unitaires — contrat de sortie du moteur (vue carte /flow).
 * Vérifie la présence de tous les champs doctrinaux + cohérence loss_leader.
 */
'use strict';

jest.mock('../../db', () => ({ query: jest.fn(async () => ({ rows: [] })) }));

const engine = require('../../services/pricing-engine');

const config = {
  finance: { target_marge_brute_pct: 40, taux_aed_kmf: 138, taux_change_eur_kmf: 492, fret_eur_per_m3: 180,
    objectif_commandes_mois: 80, avg_articles_per_order: 2.5, avg_articles_per_parcel: 4, avg_articles_per_shipment: 200,
    minimum_safety_margin_pct: 10, allocation_confidence: 'low' },
  categories: { phones: { key: 'phones', douane_pct: 5, tva_pct: 0, taxe_add_pct: 0, default_margin_pct: 40 } },
  components: [
    { key: 'packaging_box', category: 'packaging', unit: 'kmf_per_parcel', default_value: 1200 },
    { key: 'freight_sea', category: 'freight', unit: 'kmf_per_shipment', default_value: 60000 },
    { key: 'relay_commission', category: 'relay', unit: 'kmf', default_value: 500 },
    { key: 'cash_fee', category: 'payment', unit: 'kmf_per_order', default_value: 800 },
  ],
  provisions: [{ rate_pct: 2 }],
  charges: [{ recurrence_period: 'monthly', amount_kmf: 420000 }],
};

const REQUIRED = [
  'category', 'channel', 'current_price_kmf',
  'n1_landed_relay_cost_kmf', 'n2_business_variable_cost_kmf', 'variable_cost_complete_kmf',
  'contribution_kmf', 'n3_fixed_overhead_allocation_kmf', 'n3_allocation_unit', 'n3_formula', 'cdr_complete_kmf',
  'minimum_safe_price_kmf', 'recommended_price_kmf', 'final_price_kmf',
  'pricing_strategy', 'strategy_risk', 'safety_margin_pct', 'sourcing_decision',
  'data_quality', 'allocations', 'allocation_averages', 'proportions', 'strategies',
  'cost_breakdown', 'monthly_fixed_costs_kmf', 'target_orders_per_month', 'warnings',
];

describe('Contrat moteur — vue /flow', () => {
  let reco;
  beforeAll(async () => {
    reco = await engine.recommend(
      { category: 'phones', cost_kmf: 6000, weight_kg: 0.3, current_price_kmf: 12990,
        pricing_strategy: 'loss_leader', final_price_kmf: 9000 },
      { config }
    );
  });

  it.each(REQUIRED)('champ présent : %s', (k) => {
    expect(reco[k]).toBeDefined();
  });
  it('final_price reflète l\'override', () => expect(reco.final_price_kmf).toBe(9000));
  it('strategy_risk = undercovered ou destructive (9000 sous CDR)', () =>
    expect(['undercovered', 'destructive']).toContain(reco.strategy_risk));
  it('variable_cost_complete = N1 + N2', () =>
    expect(reco.variable_cost_complete_kmf).toBe(reco.n1_landed_relay_cost_kmf + reco.n2_business_variable_cost_kmf));
  it('cdr_complete = variable + N3', () =>
    expect(reco.cdr_complete_kmf).toBe(reco.variable_cost_complete_kmf + reco.n3_fixed_overhead_allocation_kmf));
  it('6 stratégies canoniques', () => expect(reco.strategies).toHaveLength(6));
  it('allocations non vides', () => expect(reco.allocations.length).toBeGreaterThan(0));
});
