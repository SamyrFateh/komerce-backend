'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn() }));

const { computeCDR } = require('../../services/pricing-cdr');

describe('LOT 1A-2 — CDR consomme la vérité FX canonique', () => {
  test('un cost_component USD utilise le taux USD→KMF de l\'autorité FX (jamais 0,92 × EUR)', () => {
    const config = {
      finance: {
        taux_change_eur_kmf: 495,
        taux_aed_kmf: 139,
        taux_usd_kmf: 455.4,
        fret_eur_per_m3: 180,
        objectif_commandes_mois: 100,
        avg_articles_per_order: 2.5,
        allocation_confidence: 'high',
      },
      categories: {
        phones: { douane_pct: 0, tva_pct: 0, taxe_add_pct: 0 },
      },
      components: [{
        key: 'usd_fixture',
        label: 'Fixture USD',
        category: 'sourcing',
        unit: 'usd',
        default_value: 10,
        scope: 'global',
      }],
      provisions: [],
      charges: [],
    };

    const out = computeCDR(
      { category: 'phones', cost_kmf: 1000, weight_kg: 1 },
      { config, volume_m3: 0.005, channel: 'cash_relais' }
    );

    // 10 USD × 455,4 KMF/USD (autorité FX, observation approuvée) = 4554 KMF.
    expect(out.details.sourcing).toBe(4554);
    expect(out.details._allocations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        component_key: 'usd_fixture',
        allocated_cost_kmf: 4554,
      }),
    ]));
  });

  test('USD sans taux approuvé : refus fx_rate_unavailable, jamais de repli', () => {
    const config = {
      finance: { taux_change_eur_kmf: 495, fret_eur_per_m3: 180, objectif_commandes_mois: 100, avg_articles_per_order: 2.5, allocation_confidence: 'high' },
      categories: { phones: { douane_pct: 0, tva_pct: 0, taxe_add_pct: 0 } },
      components: [{ key: 'usd_fixture', label: 'x', category: 'sourcing', unit: 'usd', default_value: 10, scope: 'global' }],
      provisions: [], charges: [],
    };
    expect(() => computeCDR({ category: 'phones', cost_kmf: 1000, weight_kg: 1 }, { config, volume_m3: 0.005, channel: 'cash_relais' }))
      .toThrow(expect.objectContaining({ code: 'fx_rate_unavailable' }));
  });
});
