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
    ];
    const result = await service.applyActiveMarketPricesToCheckoutItems(executor, {
      marketId: 'market-cm',
      items,
      productMap: {
        p1: { id: 'p1', price_kmf: 9000 },
      },
    });
    expect(items[0]._effective_unit_price_kmf).toBe(7500);
    expect(result.total_kmf).toBe(15000);
  });

  test('checkout refuses a resolved market without LOCAL_ACTIVE — never falls back to products.price_kmf', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const items = [{ product_id: 'p2', quantity: 1, _effective_unit_price_kmf: 5000 }];
    await expect(service.applyActiveMarketPricesToCheckoutItems(executor, {
      marketId: 'market-cm',
      items,
      productMap: { p2: { id: 'p2', price_kmf: 5000 } },
    })).rejects.toMatchObject({ code: 'market_price_not_purchasable', status: 409 });
  });

  test('checkout keeps the reference price when no market is resolved at all (no market gate applies)', async () => {
    const executor = { query: jest.fn() };
    const items = [{ product_id: 'p2', quantity: 1, _effective_unit_price_kmf: 5000 }];
    const result = await service.applyActiveMarketPricesToCheckoutItems(executor, {
      marketId: null,
      items,
      productMap: { p2: { id: 'p2', price_kmf: 5000 } },
    });
    expect(executor.query).not.toHaveBeenCalled();
    expect(result.total_kmf).toBe(5000);
  });

  test('catalog marks a product NOT_DECISIONAL when the market has zero LOCAL_ACTIVE decisions at all (early-return path)', async () => {
    const executor = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'market-1', code: 'CM', currency: 'XAF' }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const [product] = await service.applyActiveMarketPricesToCatalogRows(executor, {
      marketCode: 'cm',
      products: [{ id: 'p1', price_kmf: 9000 }],
    });
    expect(product.purchasable).toBe(false);
    expect(product.market_price_source).toBe('NOT_DECISIONAL');
    expect(product.price_kmf).toBe(9000); // référence globale inchangée, jamais promue en prix acheteur
  });

  test('catalog marks only the uncovered product NOT_DECISIONAL when some products in the batch have LOCAL_ACTIVE', async () => {
    const executor = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'market-1', code: 'CM', currency: 'XAF' }] })
        .mockResolvedValueOnce({ rows: [{ product_id: 'p1', amount: '9000', currency: 'XAF', active_at: null }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const [p1, p2] = await service.applyActiveMarketPricesToCatalogRows(executor, {
      marketCode: 'cm',
      products: [{ id: 'p1', price_kmf: 9000 }, { id: 'p2', price_kmf: 5000 }],
    });
    expect(p1.purchasable).toBe(true);
    expect(p1.market_price_source).toBe('LOCAL_ACTIVE');
    expect(p2.purchasable).toBe(false);
    expect(p2.market_price_source).toBe('NOT_DECISIONAL');
  });
});
