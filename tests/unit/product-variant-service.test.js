'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { replaceVariants, deleteVariant } = require('../../services/product-variant-service');

describe('product-variant-service', () => {
  test('replaceVariants valide le payload avant toute ouverture de transaction', async () => {
    const dbPool = { getClient: jest.fn() };

    await expect(replaceVariants(dbPool, 'p1', null)).rejects.toMatchObject({ status: 400 });
    expect(dbPool.getClient).not.toHaveBeenCalled();
  });

  test('deleteVariant refuse la suppression lorsqu’une commande active référence la variante', async () => {
    const db = { query: jest.fn().mockResolvedValueOnce({ rows: [{ cnt: '2' }] }) };

    const result = await deleteVariant(db, 'p1', 'v1');

    expect(result.status).toBe(409);
    expect(result.body.error).toMatch(/2 commande/);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('deleteVariant supprime uniquement la variante du produit demandé', async () => {
    const db = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'v1', variant_type: 'Taille', variant_value: 'M' }] }),
    };

    const result = await deleteVariant(db, 'p1', 'v1');

    expect(result.status).toBe(200);
    expect(result.body.deleted.id).toBe('v1');
    expect(db.query.mock.calls[1][0]).toMatch(/DELETE FROM product_variants/i);
    expect(db.query.mock.calls[1][1]).toEqual(['v1', 'p1']);
  });
});
