'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn() }));

const { computeCDR } = require('../../services/pricing-cdr');

describe('pricing-cdr currency allocation regression', () => {
  it('applique le volume à un tarif EUR configuré by_volume', () => {
    const cfg = {
      finance: {
        taux_change_eur_kmf: 500,
        fret_eur_per_m3: 180,
        objectif_commandes_mois: 100,
        avg_articles_per_order: 2.5,
        avg_articles_per_parcel: 4,
        avg_articles_per_shipment: 200,
        allocation_confidence: 'high',
      },
      categories: {
        vetements: { key: 'vetements', douane_pct: 20, tva_pct: 10, taxe_add_pct: 2.5 },
      },
      components: [{
        key: 'fret_maritime_eur_m3',
        label: 'Fret maritime',
        family: 'landed_relay',
        category: 'freight',
        default_value: 180,
        unit: 'eur',
        scope: 'global',
        allocation_method: 'by_volume',
      }],
      provisions: [],
      charges: [],
    };

    const result = computeCDR(
      { category: 'vetements', cost_kmf: 2072, weight_kg: 0.053 },
      { config: cfg, volume_m3: 0.00068, channel: 'cash_relais' }
    );

    const allocation = result.details._allocations.find(a => a.component_key === 'fret_maritime_eur_m3');
    // 180 EUR/m³ × 500 KMF/EUR × 0.00068 m³ = 61.2 KMF, pas 90 000 KMF/article.
    expect(allocation.allocated_cost_kmf).toBe(61);
    expect(allocation.allocation_basis).toBe('volume');
    expect(result.details.freight).toBeLessThan(500);
  });
});