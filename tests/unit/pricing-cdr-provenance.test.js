'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query: jest.fn() }));
const { computeCDR } = require('../../services/pricing-cdr');

const config = {
  finance: { fret_eur_per_m3: 180, eur_kmf: 491.97 },
  categories: { mariage: {} },
  provisions: [],
  charges: [],
  components: [
    { key: 'f', category: 'freight', unit: 'kmf', default_value: 1000 },
    { key: 'c', category: 'customs', unit: 'kmf', default_value: 25 },
    { key: 'p', category: 'port_transitary', unit: 'kmf', default_value: 290 },
    { key: 'h', category: 'hub', unit: 'kmf', default_value: 50 },
  ],
};
const product = { category: 'mariage', cost_kmf: 3000 };

describe('CDR applicabilité par provenance (L2)', () => {
  it('LOCAL_STOCK : fret/douane/port non applicables, hub conservé', () => {
    const r = computeCDR(product, { config, volume_m3: 0.01, provenance: 'LOCAL_STOCK' });
    expect(r.details.freight).toBe(0);
    expect(r.details.customs).toBe(0);
    expect(r.details.port_transitaire).toBe(0);
    expect(r.details.hub).toBe(50);
    expect(r.import_chain_not_applicable).toBe(true);
  });

  it('provenance inconnue : chaîne import conservée (inconnu ≠ zéro)', () => {
    const r = computeCDR(product, { config, volume_m3: 0.01 });
    expect(r.details.freight).toBeGreaterThan(1000);
    expect(r.details.customs).toBe(25);
    expect(r.details.port_transitaire).toBe(290);
  });
});
