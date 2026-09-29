'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const mockBuildCorridor = jest.fn();
const mockShape = jest.fn();

jest.mock('../../services/pricing-market-corridor', () => ({
  buildMarketCorridorForProduct: (...args) => mockBuildCorridor(...args),
}));
jest.mock('../../services/market-local-price-resolution-service', () => ({
  assertProductPriceShapeCompatible: (...args) => mockShape(...args),
}));

const projection = require('../../services/market-ready-to-sell-projection');

function executor(priceRows, productRows) {
  return {
    query: jest.fn(async sql => {
      if (String(sql).includes('FROM product_market_price_drafts')) return { rows: priceRows };
      if (String(sql).includes('FROM products')) return { rows: productRows };
      throw new Error('unexpected SQL: ' + sql);
    }),
  };
}

function corridorFor(ref, active = false) {
  return {
    product: { product_ref: ref },
    selected: { source: active ? 'LOCAL_ACTIVE' : 'GLOBAL_BASE', local_amount: active ? 19000 : null },
    candidate: null,
    corridor: {
      local: {
        status: 'READY',
        confidence: 'high',
        sample_count: 8,
        low: { observed_amount: 16000 },
        target: { observed_amount: 18000 },
        high: { observed_amount: 21000 },
        viability: { status: 'VIABLE', label: 'Viable' },
      },
    },
  };
}

describe('market-ready-to-sell-projection', () => {
  beforeEach(() => {
    mockBuildCorridor.mockReset();
    mockShape.mockReset().mockResolvedValue(true);
  });

  test('assemble candidat prêt, publié sans décision et exposition sans prix', async () => {
    const db = executor(
      [
        { product_id: 'p2', amount: 19000, currency: 'KMF', status: 'LOCAL_ACTIVE' },
        { product_id: 'p3', amount: 17500, currency: 'KMF', status: 'DRAFT_PENDING_GATE' },
      ],
      [
        { id: 'p1', product_ref: 'KPR-1', name: 'Candidat', category: 'phones', price_kmf: 18000, cost_kmf: 9000, is_active: false },
        { id: 'p2', product_ref: 'KPR-2', name: 'Publié', category: 'phones', price_kmf: 18000, cost_kmf: 9000, is_active: true },
        { id: 'p3', product_ref: 'KPR-3', name: 'Prix inachevé', category: 'phones', price_kmf: 18000, cost_kmf: 9000, is_active: true },
      ]
    );
    mockBuildCorridor
      .mockResolvedValueOnce(corridorFor('KPR-1'))
      .mockResolvedValueOnce(corridorFor('KPR-2', true))
      .mockResolvedValueOnce(corridorFor('KPR-3'));

    const result = await projection.buildReadyToSell({
      executor: db,
      market: { id: 'mkt-km', code: 'KM', name: 'Comores', currency: 'KMF' },
      capabilities: ['catalog.expose', 'pricing.decide', 'pricing.activate'],
      reviewQueue: { items: [{ product_id: 'p1', product_ref: 'KPR-1' }] },
      exposure: [
        { product_id: 'p2', product_ref: 'KPR-2', decision_recorded: false, commercial_exposure: 'DISABLED' },
        { product_id: 'p3', product_ref: 'KPR-3', decision_recorded: true, commercial_exposure: 'ENABLED' },
      ],
    });

    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toMatchObject({
      product_ref: 'KPR-1',
      catalog_state: 'candidate',
      proposed_price: { amount: 18000, source: 'MARKET_TARGET' },
      bulk_eligible: true,
    });
    expect(result.items[1]).toMatchObject({
      product_ref: 'KPR-2',
      local_price_active: true,
      decision_state: { key: 'READY' },
      bulk_eligible: true,
    });
    expect(result.items[2]).toMatchObject({
      product_ref: 'KPR-3',
      proposed_price: { amount: 17500, source: 'EXISTING_LOCAL_DECISION' },
      bulk_eligible: false,
    });
    expect(result.summary).toEqual({ total: 3, ready: 3, review: 0, blocked: 0, bulk_eligible: 2 });
  });

  test('un viewer voit la file mais ne peut pas approuver', async () => {
    const db = executor([], [
      { id: 'p1', product_ref: 'KPR-1', name: 'Candidat', category: 'phones', price_kmf: 18000, cost_kmf: 9000, is_active: false },
    ]);
    mockBuildCorridor.mockResolvedValueOnce(corridorFor('KPR-1'));

    const result = await projection.buildReadyToSell({
      executor: db,
      market: { id: 'mkt-km', code: 'KM', name: 'Comores', currency: 'KMF' },
      capabilities: ['catalog.read', 'pricing.read'],
      reviewQueue: { items: [{ product_id: 'p1', product_ref: 'KPR-1' }] },
      exposure: [],
    });

    expect(result.items[0].can_approve).toBe(false);
    expect(result.items[0].bulk_eligible).toBe(false);
  });

  test('la projection reste strictement read-only', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'market-ready-to-sell-projection.js'), 'utf8');
    expect(source).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b\s+(?:INTO|FROM|products|product_)/i);
  });
});
