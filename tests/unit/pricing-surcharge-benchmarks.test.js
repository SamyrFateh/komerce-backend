/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * Tests unitaires — calibration de la surcharge par benchmark (doctrine §6).
 * Sans benchmark → heuristique ; avec → calibré ; précédence catégorie.
 */
'use strict';

jest.mock('../../db', () => ({ query: jest.fn(async () => ({ rows: [] })) }));

const engine = require('../../services/pricing-engine');

function baseConfig(benchmarks) {
  return {
    finance: { target_marge_brute_pct: 40, taux_aed_kmf: 138, taux_change_eur_kmf: 492, fret_eur_per_m3: 180,
      objectif_commandes_mois: 80, avg_articles_per_order: 2.5, avg_articles_per_parcel: 4, avg_articles_per_shipment: 200,
      minimum_safety_margin_pct: 10, allocation_confidence: 'low' },
    categories: { phones: { key: 'phones', douane_pct: 5, tva_pct: 0, taxe_add_pct: 0, default_margin_pct: 40 } },
    components: [
      { key: 'hub_fee', category: 'hub', unit: 'kmf', default_value: 2500 },
      { key: 'cash_fee', category: 'payment', unit: 'kmf_per_order', default_value: 800 },
    ],
    provisions: [{ rate_pct: 2 }],
    charges: [{ recurrence_period: 'monthly', amount_kmf: 420000 }],
    cost_benchmarks: benchmarks || [],
  };
}
const input = { category: 'phones', cost_kmf: 6000, weight_kg: 0.3, current_price_kmf: 12990 };
const hub = reco => reco.proportions.lines.find(l => l.cost_key === 'hub');

describe('Surcharge — calibration par benchmark', () => {
  it('sans benchmark : Hub en surcharge heuristique, confiance basse', async () => {
    const r = await engine.recommend(input, { config: baseConfig([]) });
    const h = hub(r);
    expect(h.diagnostic).toBe('surcharge');
    expect(h.basis).toBe('heuristic');
    expect(r.proportions.confidence).toBe('low');
  });

  it('benchmark Hub 8% : surcharge calibrée, confiance haute', async () => {
    const r = await engine.recommend(input, { config: baseConfig([
      { category: 'all', cost_family: 'hub', expected_share_pct: 8, warn_ratio: 1.3, alert_ratio: 1.6 },
    ]) });
    const h = hub(r);
    expect(h.diagnostic).toBe('surcharge');
    expect(h.basis).toBe('benchmark');
    expect(h.confidence).toBe('high');
  });

  it('benchmark Hub 30% : redevient normal', async () => {
    const r = await engine.recommend(input, { config: baseConfig([
      { category: 'all', cost_family: 'hub', expected_share_pct: 30 },
    ]) });
    expect(hub(r).diagnostic).toBe('normal');
  });

  it('précédence catégorie : phones (8%) l\'emporte sur all (30%)', async () => {
    const r = await engine.recommend(input, { config: baseConfig([
      { category: 'all', cost_family: 'hub', expected_share_pct: 30 },
      { category: 'phones', cost_family: 'hub', expected_share_pct: 8 },
    ]) });
    const h = hub(r);
    expect(h.expected_share_pct).toBe(8);
    expect(h.diagnostic).toBe('surcharge');
  });
});
