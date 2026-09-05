'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  canonicalizeVariantCombo,
  resolveActiveSku,
  auditProductSkuReadiness,
} = require('../../services/product-sku-service');

describe('product-sku-service', () => {
  test('canonicalizeVariantCombo trie et normalise les axes', () => {
    expect(canonicalizeVariantCombo({ Taille: ' M ', Couleur: ' Noir ' })).toEqual({
      Couleur: 'Noir',
      Taille: 'M',
    });
    expect(canonicalizeVariantCombo(null)).toBeNull();
    expect(() => canonicalizeVariantCombo({})).toThrow(/objet vide/);
  });

  test('resolveActiveSku résout le SKU actif de la combinaison canonique', async () => {
    const db = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: 'sku1', sku: 'SKU-1', stock: 4, price_kmf: 2500 }] }),
    };

    const row = await resolveActiveSku(db, 'p1', { Taille: ' M ', Couleur: 'Noir' });

    expect(row.id).toBe('sku1');
    expect(db.query).toHaveBeenCalledWith(expect.stringMatching(/variant_combo = \$2::jsonb/), [
      'p1',
      JSON.stringify({ Couleur: 'Noir', Taille: 'M' }),
    ]);
  });

  test('auditProductSkuReadiness reconnaît immédiatement un produit déjà en SKU', async () => {
    const db = {
      query: jest.fn().mockResolvedValueOnce({
        rows: [{ id: 'p1', name: 'Produit', has_variants: true, inventory_model: 'SKU' }],
      }),
    };

    await expect(auditProductSkuReadiness(db, 'p1')).resolves.toEqual({
      product_id: 'p1',
      ready: true,
      already_sku: true,
      reasons: ['Déjà en mode SKU'],
    });
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});
