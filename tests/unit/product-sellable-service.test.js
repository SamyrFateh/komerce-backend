'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  applyCanonicalPromotion,
  computeSellablePricing,
  resolveSellableUnit,
} = require('../../services/product-sellable-service');

describe('product-sellable-service', () => {
  test('applyCanonicalPromotion applique uniquement une promotion active', () => {
    const now = new Date('2026-09-05T12:00:00Z');

    expect(applyCanonicalPromotion(10000, {
      is_promo: true,
      promo_pct: 20,
      promo_until: '2026-09-06T00:00:00Z',
    }, now)).toBe(8000);

    expect(applyCanonicalPromotion(10000, {
      is_promo: true,
      promo_pct: 20,
      promo_until: '2026-09-04T00:00:00Z',
    }, now)).toBe(10000);
  });

  test('computeSellablePricing privilégie le prix SKU puis applique la promotion canonique', () => {
    const result = computeSellablePricing({
      product: { price_kmf: 10000, is_promo: true, promo_pct: 10, promo_until: null },
      resolvedSku: { price_kmf: 8000 },
      now: new Date('2026-09-05T12:00:00Z'),
    });

    expect(result).toEqual({
      base_unit_price_kmf: 8000,
      effective_unit_price_kmf: 7200,
    });
  });

  test('resolveSellableUnit refuse un produit absent ou inactif', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };

    await expect(resolveSellableUnit(db, { productId: 'p1' })).rejects.toMatchObject({
      status: 404,
      code: 'product_not_found',
    });
  });
});
