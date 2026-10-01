'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  createDraftProductFromSourcingCandidate,
  hasVariantsFromCandidate,
  draftPurchaseCostFromCandidate,
  draftStockFromCandidate,
} = require('../../services/catalog-candidate-product-service');

describe('catalog-candidate-product-service', () => {
  it('creates the inactive candidate product through the injected transaction client', async () => {
    const q = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ category: 'Mode & Beauté', subcategory: 'Femme' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'product-1' }] }),
    };
    const candidate = {
      product_name: 'Chemise',
      komerce_category: 'mode',
      purchase_price_kmf: 1200,
      estimated_weight_kg: 0.4,
      stock_available: 17,
      description: 'Raw supplier description',
      raw_payload: {
        discovery: {
          target_category: 'Mode & Beauté',
          target_subcategory: 'Femme',
        },
      },
    };

    await expect(createDraftProductFromSourcingCandidate(q, {
      candidate,
      initialPrice: 2500,
    })).resolves.toBe('product-1');

    expect(q.query).toHaveBeenCalledTimes(2);
    expect(q.query.mock.calls[0][0]).toContain('FROM boutique_categories');
    expect(q.query.mock.calls[1][0]).toContain('INSERT INTO products');
    expect(q.query.mock.calls[1][0]).toContain("FALSE, 'candidate'");
    expect(q.query.mock.calls[1][1]).toEqual([
      'Chemise',
      'mode',
      'Mode & Beauté',
      'Femme',
      1200,
      2500,
      17,
      0.4,
      false,
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
      null,
      null,
      null,
      900,
      0,
      null,
      false,
      'Produit brut',
      null,
      'en',
    ]);
  });
});


  it('does not confuse customs category with boutique taxonomy', async () => {
    const q = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ category: 'Tech', subcategory: 'Audio' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'product-3' }] }),
    };

    await createDraftProductFromSourcingCandidate(q, {
      candidate: {
        product_name: 'Casque',
        komerce_category: 'electro',
        raw_payload: {
          discovery: {
            target_category: 'Tech',
            target_subcategory: 'Audio',
          },
        },
      },
      initialPrice: 12000,
    });

    const sql = q.query.mock.calls[1][0];
    const params = q.query.mock.calls[1][1];
    expect(sql).toContain('boutique_category_key');
    expect(sql).toContain('boutique_subcategory_key');
    expect(params[1]).toBe('electro');
    expect(params[2]).toBe('Tech');
    expect(params[3]).toBe('Audio');
  });

describe('catalog draft supplier truth', () => {
  it('ne fabrique ni coût fournisseur ni variantes absentes', () => {
    expect(draftPurchaseCostFromCandidate({})).toBeNull();
    expect(draftPurchaseCostFromCandidate({ purchase_price_kmf: 0 })).toBeNull();
    expect(draftPurchaseCostFromCandidate({ purchase_price_kmf: 1250 })).toBe(1250);
    expect(hasVariantsFromCandidate({})).toBe(false);
  });

  it('déduit has_variants uniquement des unités fournisseur réellement optionnées', () => {
    expect(hasVariantsFromCandidate({
      normalized_source_contract: {
        sellable_units: [
          { supplier_sku: 'CJ-1', option_values: { cj_size: 'M' } },
          { supplier_sku: 'CJ-2', option_values: { cj_size: 'L' } },
        ],
      },
    })).toBe(true);

    expect(hasVariantsFromCandidate({
      normalized_source_contract: {
        sellable_units: [{ supplier_sku: 'CJ-DEFAULT', option_values: {} }],
      },
    })).toBe(false);
  });
});

describe('catalog draft stock truth', () => {
  it('reprend le stock source connu et ne fabrique jamais le défaut historique 100', () => {
    expect(draftStockFromCandidate({ stock_available: 23 })).toBe(23);
    expect(draftStockFromCandidate({ stock_available: '7' })).toBe(7);
    expect(draftStockFromCandidate({ stock_available: null })).toBe(0);
    expect(draftStockFromCandidate({})).toBe(0);
    expect(draftStockFromCandidate({ stock_available: -1 })).toBe(0);
  });
});

describe('catalog candidate boutique taxonomy guard', () => {
  it('refuses an inactive or unknown discovery subcategory before product creation', async () => {
    const { createDraftProductFromSourcingCandidate } = require('../../services/catalog-candidate-product-service');
    const q = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };
    await expect(createDraftProductFromSourcingCandidate(q, {
      candidate: {
        product_name: 'Produit',
        raw_payload: { discovery: { target_category: 'Tech', target_subcategory: 'Introuvable' } },
      },
      initialPrice: 1000,
    })).rejects.toThrow(/BOUTIQUE_TAXONOMY_INVALID/);
    expect(q.query).toHaveBeenCalledTimes(1);
  });
});
