'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { adjustStock } = require('../../services/product-stock-service');

describe('product-stock-service', () => {
  test('refuse bruyamment un item SKU sans sku_id, sans fallback legacy', async () => {
    const db = { query: jest.fn() };

    await expect(adjustStock(db, [
      { product_id: 'p1', quantity: 2, inventory_model: 'SKU', sku_id: null },
    ], 'decrement')).rejects.toMatchObject({ status: 500 });

    expect(db.query).not.toHaveBeenCalled();
  });

  test('un item SKU écrit uniquement product_skus', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'sku1' }] }) };

    await adjustStock(db, [
      { product_id: 'p1', quantity: 2, inventory_model: 'SKU', sku_id: 'sku1' },
    ], 'decrement');

    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toMatch(/UPDATE product_skus SET stock = stock - \$1/i);
    expect(db.query.mock.calls[0][1]).toEqual([2, 'sku1', 'p1']);
  });

  test('un item legacy ajuste products puis les variantes déclarées', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };

    await adjustStock(db, [{
      product_id: 'p1',
      quantity: 3,
      inventory_model: 'LEGACY_VARIANTS',
      has_variants: true,
      variant_combo: { Taille: 'M', Couleur: 'Noir' },
    }], 'increment');

    expect(db.query).toHaveBeenCalledTimes(3);
    expect(db.query.mock.calls[0][0]).toMatch(/UPDATE products SET stock = stock \+ \$1/i);
    expect(db.query.mock.calls[1][0]).toMatch(/UPDATE product_variants/i);
    expect(db.query.mock.calls[2][0]).toMatch(/UPDATE product_variants/i);
  });
});
