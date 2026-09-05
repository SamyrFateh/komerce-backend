'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../services/product-sku-service', () => ({
  resolveActiveSku: jest.fn(),
  canonicalizeVariantCombo: jest.fn(v => v),
}));
jest.mock('../../services/product-sellable-service', () => ({
  computeSellablePricing: jest.fn(() => ({ effective_unit_price_kmf: 1000 })),
}));

const { resolveCheckoutItems } = require('../../services/order-checkout-item-resolution');

describe('order-checkout-item-resolution', () => {
  test('refuse une ligne sans product_id canonique', async () => {
    const client = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };
    const result = await resolveCheckoutItems({
      client,
      items: [{ quantity: 1 }],
      maxQty: 10,
      fretPerKg: 0,
      aedFallback: 0,
      customsPct: 0,
      pickupCodeRecipient: 'buyer',
      userId: 'u1',
    });
    expect(result).toEqual({ ok: false, status: 400, body: { error: 'product_id invalide' } });
  });

  test('refuse une quantité hors borne avant toute écriture', async () => {
    const client = {
      query: jest.fn().mockResolvedValueOnce({ rows: [{
        id: 'p1', name: 'Produit', inventory_model: 'LEGACY_VARIANTS', stock: 20,
        has_variants: false, price_kmf: 1000,
      }] }),
    };
    const result = await resolveCheckoutItems({
      client,
      items: [{ product_id: 'p1', quantity: 99 }],
      maxQty: 10,
      fretPerKg: 0,
      aedFallback: 0,
      customsPct: 0,
      pickupCodeRecipient: 'buyer',
      userId: 'u1',
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/Quantité invalide/);
    expect(client.query).toHaveBeenCalledTimes(1);
  });
});
