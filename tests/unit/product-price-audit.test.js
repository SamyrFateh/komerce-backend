'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const mockLogFn = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
jest.mock('../../utils/logger', () => { const f = jest.fn(mockLogFn); return { child: f, forModule: f, info: jest.fn(), warn: jest.fn(), error: jest.fn() }; });

const { recordProductPriceChange } = require('../../services/product-price-audit');

describe('product-price-audit', () => {
  it('skip sans productId, prix invalide ou prix inchange', async () => {
    const q = { query: jest.fn() };

    await expect(recordProductPriceChange(q, { oldPriceKmf: 100, newPriceKmf: 200 })).resolves.toEqual({ skipped: true, reason: 'missing_product_id' });
    await expect(recordProductPriceChange(q, { productId: 'prod-001', oldPriceKmf: 100, newPriceKmf: 0 })).resolves.toEqual({ skipped: true, reason: 'invalid_new_price' });
    await expect(recordProductPriceChange(q, { productId: 'prod-001', oldPriceKmf: 100, newPriceKmf: 100 })).resolves.toEqual({ skipped: true, reason: 'unchanged' });
    expect(q.query).not.toHaveBeenCalled();
  });

  it('insere lhistorique enrichi si les colonnes existent', async () => {
    const q = { query: jest.fn().mockResolvedValueOnce({ rows: [], rowCount: 1 }) };

    await expect(recordProductPriceChange(q, {
      productId: 'prod-001', oldPriceKmf: 1000, newPriceKmf: 1500,
      source: 'admin', appliedBy: 'admin-001', scenarioId: 'sc-1', scenarioLabel: 'test', levier: 'margin', note: 'ignored',
    })).resolves.toEqual({ inserted: true, enriched: true });

    expect(q.query).toHaveBeenCalledWith(expect.stringContaining('scenario_id'), [
      'prod-001', 1000, 1500, 'admin', 'admin-001', 'sc-1', 'test', 'margin',
    ]);
  });

  it('fallback sur insertion simple si schema enrichi indisponible', async () => {
    const q = { query: jest.fn()
      .mockRejectedValueOnce(new Error('column missing'))
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) };

    await expect(recordProductPriceChange(q, { productId: 'prod-001', oldPriceKmf: 1000, newPriceKmf: 1500, source: 'admin', appliedBy: 'admin-001' }))
      .resolves.toEqual({ inserted: true, enriched: false });
    expect(q.query.mock.calls[1][0]).not.toContain('scenario_id');
    expect(q.query.mock.calls[1][1]).toEqual(['prod-001', 1000, 1500, 'admin', 'admin-001']);
  });

  it('ne bloque pas si meme le fallback echoue', async () => {
    const q = { query: jest.fn()
      .mockRejectedValueOnce(new Error('column missing'))
      .mockRejectedValueOnce(new Error('price_history missing')) };

    await expect(recordProductPriceChange(q, { productId: 'prod-001', oldPriceKmf: 1000, newPriceKmf: 1500 }))
      .resolves.toEqual({ skipped: true, reason: 'price_history missing' });
  });
});
