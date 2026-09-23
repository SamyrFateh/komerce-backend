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

describe('order-checkout-item-resolution — total demandé par SKU exact', () => {
  const { resolveActiveSku } = require('../../services/product-sku-service');
  const product = {
    id: 'p1', name: 'Produit SKU', inventory_model: 'SKU',
    stock: 999, price_kmf: 1000, has_variants: false,
  };
  function args(items, stock) {
    resolveActiveSku.mockReset().mockResolvedValue({ id: 'sku-1', stock, price_kmf: 1000 });
    const client = { query: jest.fn().mockResolvedValue({ rows: [product] }) };
    return {
      client, items, maxQty: 10, fretPerKg: 0, aedFallback: 0, customsPct: 0,
      pickupCodeRecipient: 'buyer', userId: 'u1',
    };
  }

  test('deux lignes du même SKU 2+2 sont refusées si son stock vaut 3', async () => {
    const input = args([
      { product_id: 'p1', quantity: 2 },
      { product_id: 'p1', quantity: 2 },
    ], 3);
    const result = await resolveCheckoutItems(input);
    expect(result).toMatchObject({
      ok: false, status: 409, body: { available_stock: 3 },
    });
    // No order persistence or stock write: this resolver only reads.
    expect(input.client.query).toHaveBeenCalledTimes(1);
    expect(resolveActiveSku).toHaveBeenCalledTimes(2);
  });

  test('la demande agrégée 2+1 est seulement admissible par stock catalogue 3', async () => {
    const input = args([
      { product_id: 'p1', quantity: 2 },
      { product_id: 'p1', quantity: 1 },
    ], 3);
    const result = await resolveCheckoutItems(input);
    expect(result.ok).toBe(true);
    expect(input.items.map(i => i._resolved_sku_id)).toEqual(['sku-1', 'sku-1']);
    // This test does NOT assert any supplier availability or reservation.
  });

  test('deux SKU différents ne partagent jamais le même compteur', async () => {
    const input = args([
      { product_id: 'p1', quantity: 2 },
      { product_id: 'p1', quantity: 2, variant_combo: { size: 'M' } },
    ], 3);
    resolveActiveSku
      .mockResolvedValueOnce({ id: 'sku-A', stock: 3, price_kmf: 1000 })
      .mockResolvedValueOnce({ id: 'sku-B', stock: 3, price_kmf: 1000 });
    const result = await resolveCheckoutItems(input);
    expect(result.ok).toBe(true);
    expect(input.items.map(i => i._resolved_sku_id)).toEqual(['sku-A', 'sku-B']);
  });
});
