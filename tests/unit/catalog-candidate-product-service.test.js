'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { createDraftProductFromSourcingCandidate } = require('../../services/catalog-candidate-product-service');

describe('catalog-candidate-product-service', () => {
  it('creates the inactive candidate product through the injected transaction client', async () => {
    const q = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: 'product-1' }] }),
    };
    const candidate = {
      product_name: 'Chemise',
      komerce_category: 'mode',
      purchase_price_kmf: 1200,
      estimated_weight_kg: 0.4,
      description: 'Raw supplier description',
    };

    await expect(createDraftProductFromSourcingCandidate(q, {
      candidate,
      initialPrice: 2500,
    })).resolves.toBe('product-1');

    expect(q.query).toHaveBeenCalledTimes(1);
    expect(q.query.mock.calls[0][0]).toContain('INSERT INTO products');
    expect(q.query.mock.calls[0][0]).toContain("FALSE, 'candidate'");
    expect(q.query.mock.calls[0][1]).toEqual([
      'Chemise',
      'mode',
      1200,
      2500,
      0.4,
      'Chemise',
      'Raw supplier description',
      'en',
    ]);
  });

  it('preserves historical catalog fallbacks', async () => {
    const q = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: 'product-2' }] }),
    };

    await createDraftProductFromSourcingCandidate(q, {
      candidate: { product_name: 'Produit brut' },
      initialPrice: 900,
    });

    expect(q.query.mock.calls[0][1]).toEqual([
      'Produit brut',
      'autre',
      0,
      900,
      null,
      'Produit brut',
      null,
      'en',
    ]);
  });
});
