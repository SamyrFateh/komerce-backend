'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

let mockDbQuery;
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

const MARKET_ID = '22222222-2222-2222-2222-222222222222';
const P1 = '11111111-1111-1111-1111-111111111111';
const P2 = '99999999-9999-9999-9999-999999999999';

function loadService() {
  jest.resetModules();
  jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));
  return require('../../services/local-stock-checkout-preview');
}

beforeEach(() => {
  mockDbQuery = jest.fn();
});

describe('previewCheckoutFulfillmentSources', () => {
  it('sans marché, projette IMPORT sans lecture DB', async () => {
    const { previewCheckoutFulfillmentSources } = loadService();
    const result = await previewCheckoutFulfillmentSources({
      marketId: null,
      demands: [{ productId: P1, quantity: 2 }],
    });

    expect(result).toEqual({ [P1]: 'IMPORT' });
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('sans ligne locale exposée, projette IMPORT', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const { previewCheckoutFulfillmentSources } = loadService();

    const result = await previewCheckoutFulfillmentSources({
      marketId: MARKET_ID,
      demands: [{ productId: P1, quantity: 1 }],
    });

    expect(result[P1]).toBe('IMPORT');
  });

  it('projection locale : déduit les allocations actives et respecte la quantité demandée', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: '44444444-4444-4444-4444-444444444444',
        qty_physical: 8,
        commercial_exposure: 'ENABLED',
        active_allocated: 3,
      }],
    });
    const { previewCheckoutFulfillmentSources } = loadService();

    const result = await previewCheckoutFulfillmentSources({
      marketId: MARKET_ID,
      demands: [{ productId: P1, quantity: 5 }],
    });

    expect(result[P1]).toBe('LOCAL_STOCK');
    expect(mockDbQuery.mock.calls[0][0]).toMatch(/local_stock_allocations/);
    expect(mockDbQuery.mock.calls[0][0]).not.toMatch(/FOR UPDATE/);
  });

  it('lane locale exposée déjà insuffisante → REVIEW_REQUIRED, jamais IMPORT silencieux', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: '44444444-4444-4444-4444-444444444444',
        qty_physical: 5,
        commercial_exposure: 'ENABLED',
        active_allocated: 2,
      }],
    });
    const { previewCheckoutFulfillmentSources } = loadService();

    const result = await previewCheckoutFulfillmentSources({
      marketId: MARKET_ID,
      demands: [{ productId: P1, quantity: 4 }],
    });

    expect(result[P1]).toBe('REVIEW_REQUIRED');
  });

  it('agrège plusieurs lignes du même produit avant de projeter', async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: '44444444-4444-4444-4444-444444444444',
          qty_physical: 5,
          commercial_exposure: 'ENABLED',
          active_allocated: 0,
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const { previewCheckoutFulfillmentSources } = loadService();
    const result = await previewCheckoutFulfillmentSources({
      marketId: MARKET_ID,
      demands: [
        { productId: P2, quantity: 1 },
        { productId: P1, quantity: 2 },
        { productId: P1, quantity: 3 },
      ],
    });

    expect(result).toEqual({ [P1]: 'LOCAL_STOCK', [P2]: 'IMPORT' });
    expect(mockDbQuery).toHaveBeenCalledTimes(2);
    expect(mockDbQuery.mock.calls[0][1]).toEqual([P1, MARKET_ID, 'KM_MAIN']);
  });

  it('refuse une quantité invalide avant lecture DB', async () => {
    const { previewCheckoutFulfillmentSources } = loadService();
    await expect(previewCheckoutFulfillmentSources({
      marketId: MARKET_ID,
      demands: [{ productId: P1, quantity: 0 }],
    })).rejects.toThrow(/quantity doit être un entier positif/);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });
});