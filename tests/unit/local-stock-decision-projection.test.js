'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

let mockQuery;
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

function loadService() {
  jest.resetModules();
  jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
  return require('../../services/local-stock-decision-projection');
}

const PRODUCT_ID = '11111111-1111-1111-1111-111111111111';
const MARKET_ID = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  mockQuery = jest.fn();
});

describe('local-stock decision projection', () => {
  test('absence de ligne locale reste explicitement tracked=false, jamais une rupture', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const service = loadService();

    await expect(service.getDecisionAvailabilityEvidence(PRODUCT_ID, MARKET_ID)).resolves.toEqual({
      tracked: false,
      commercial_exposure: null,
      availability: 'UNAVAILABLE',
      exposable: false,
      authority: 'LOCAL_STOCK',
      basis: 'physical_minus_active_allocations',
    });
  });

  test('exposition ENABLED sans disponibilité nette reste suivie mais non exposable', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ commercial_exposure: 'ENABLED', available_quantity: 0 }],
    });
    const service = loadService();

    await expect(service.getDecisionAvailabilityEvidence(PRODUCT_ID, MARKET_ID)).resolves.toEqual({
      tracked: true,
      commercial_exposure: 'ENABLED',
      availability: 'UNAVAILABLE',
      exposable: false,
      authority: 'LOCAL_STOCK',
      basis: 'physical_minus_active_allocations',
    });
  });

  test('exposition ENABLED avec disponibilité nette devient AVAILABLE_NOW + exposable', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ commercial_exposure: 'ENABLED', available_quantity: 3 }],
    });
    const service = loadService();

    await expect(service.getDecisionAvailabilityEvidence(PRODUCT_ID, MARKET_ID)).resolves.toEqual({
      tracked: true,
      commercial_exposure: 'ENABLED',
      availability: 'AVAILABLE_NOW',
      exposable: true,
      authority: 'LOCAL_STOCK',
      basis: 'physical_minus_active_allocations',
    });
  });

  test('exposition DISABLED ne devient jamais exposable même si des unités existent', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ commercial_exposure: 'DISABLED', available_quantity: 5 }],
    });
    const service = loadService();

    const result = await service.getDecisionAvailabilityEvidence(PRODUCT_ID, MARKET_ID);
    expect(result).toMatchObject({
      tracked: true,
      commercial_exposure: 'DISABLED',
      availability: 'AVAILABLE_NOW',
      exposable: false,
    });
  });

  test('la vérité nette déduit les allocations actives et ne lit jamais products.stock', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const service = loadService();
    await service.getDecisionAvailabilityEvidence(PRODUCT_ID, MARKET_ID);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/FROM local_stock ls/i);
    expect(sql).toMatch(/FROM local_stock_allocations a/i);
    expect(sql).toMatch(/consumed_at IS NULL/i);
    expect(sql).toMatch(/released_at IS NULL/i);
    expect(sql).not.toMatch(/products\.stock/i);
    expect(sql).not.toMatch(/product_skus/i);
    expect(params).toEqual([PRODUCT_ID, MARKET_ID, 'KM_MAIN']);
  });

  test('ne renvoie ni quantité brute ni identifiant interne', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ commercial_exposure: 'ENABLED', available_quantity: 2 }],
    });
    const service = loadService();
    const result = await service.getDecisionAvailabilityEvidence(PRODUCT_ID, MARKET_ID);

    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('product_id');
    expect(result).not.toHaveProperty('market_id');
    expect(result).not.toHaveProperty('qty_physical');
    expect(result).not.toHaveProperty('available_quantity');
  });
});