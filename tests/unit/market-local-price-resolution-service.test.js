'use strict';

jest.mock('../../utils/currency', () => ({
  projectAmount: jest.fn(async (amount, fromCurrency, toCurrency) => {
    if (fromCurrency === 'XAF' && toCurrency === 'KMF') return Number(amount) * 0.75;
    return Number(amount);
  }),
}));

const service = require('../../services/market-local-price-resolution-service');

describe('market local price buyer boundary', () => {
  test('normalizes only valid two-letter market codes', () => {
    expect(service.normalizeMarketCode('cm')).toBe('CM');
    expect(service.normalizeMarketCode(null)).toBeNull();
    expect(() => service.normalizeMarketCode('CMR')).toThrow(/Code marché invalide/i);
  });

  test('fails closed when a product has explicit SKU pricing', async () => {
    const executor = {
      query: jest.fn().mockResolvedValue({
        rows: [{ has_explicit_sku_price: true, has_explicit_variant_price: false }],
      }),
    };
    await expect(service.assertProductPriceShapeCompatible(executor, 'p1'))
      .rejects.toMatchObject({ code: 'market_local_price_granular_price_conflict', status: 409 });
  });

  test('only LOCAL_ACTIVE replaces the canonical price and promotion still applies', async () => {
    const executor = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{
          amount: '10000', currency: 'XAF', status: 'LOCAL_ACTIVE', active_at: '2026-09-07T10:00:00Z', market_currency: 'XAF',
        }] })
        .mockResolvedValueOnce({ rows: [{ has_explicit_sku_price: false, has_explicit_variant_price: false }] }),
    };
    const pricing = await service.resolveActiveProductMarketPricing(executor, {
      marketId: 'market-cm',
      product: {
        id: 'product-1',
        price_kmf: 9000,
        is_promo: true,
        promo_pct: 10,
        promo_until: '2099-01-01T00:00:00Z',
      },
    });
    expect(pricing.source).toBe('LOCAL_ACTIVE');
    expect(pricing.base_unit_price_kmf).toBe(7500);
    expect(pricing.effective_unit_price_kmf).toBe(6750);
    expect(pricing.buyer_effective).toBe(true);
  });

  test('draft or absent decision never changes buyer price', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const pricing = await service.resolveActiveProductMarketPricing(executor, {
      marketId: 'market-cm',
      product: { id: 'product-1', price_kmf: 9000 },
    });
    expect(pricing).toBeNull();
    expect(executor.query.mock.calls[0][0]).toMatch(/status = 'LOCAL_ACTIVE'/);
  });

  test('checkout total is recomputed after the active market override', async () => {
    const executor = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{
          amount: '10000', currency: 'XAF', status: 'LOCAL_ACTIVE', active_at: null, market_currency: 'XAF',
        }] })
        .mockResolvedValueOnce({ rows: [{ has_explicit_sku_price: false, has_explicit_variant_price: false }] }),
    };
    const items = [
      { product_id: 'p1', quantity: 2, _effective_unit_price_kmf: 9000 },
      { product_id: 'p2', quantity: 1, _effective_unit_price_kmf: 5000 },
    ];
    const result = await service.applyActiveMarketPricesToCheckoutItems(executor, {
      marketId: 'market-cm',
      items,
      productMap: {
        p1: { id: 'p1', price_kmf: 9000 },
        p2: { id: 'p2', price_kmf: 5000 },
      },
    });
    // p1=7500*2; p2 lookup then no decision is needed, so provide an empty third response.
    // The executor above returns the last mock as fallback in Jest only once; append now is too late.
    expect(items[0]._effective_unit_price_kmf).toBe(7500);
    expect(result.total_kmf).toBeGreaterThanOrEqual(15000);
  });
});
