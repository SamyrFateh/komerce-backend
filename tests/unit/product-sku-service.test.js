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
  activateProductSkuInventoryModel,
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

  test('bascule explicitement en SKU seulement après audit READY', async () => {
    const db = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ variant_type: 'cj_size', variant_value: 'M' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'Produit CJ', has_variants: false, inventory_model: 'LEGACY_VARIANTS' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'sku1', variant_combo: { cj_size: 'M' } }] })
        .mockResolvedValueOnce({ rows: [{ variant_type: 'cj_size', variant_value: 'M' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'p1', inventory_model: 'SKU', has_variants: true }] }),
    };

    const result = await activateProductSkuInventoryModel(db, 'p1');

    expect(result).toMatchObject({
      ready: true,
      inventory_model: 'SKU',
      has_variants: true,
      active_sku_count: 1,
    });
    const updateCall = db.query.mock.calls.find(([sql]) => String(sql).includes("inventory_model = 'SKU'"));
    expect(updateCall).toBeTruthy();
    expect(updateCall[1]).toEqual(['p1', true]);
  });

  test('refuse la bascule SKU quand aucune unité active n’est READY', async () => {
    const db = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ variant_type: 'cj_size', variant_value: 'M' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'Produit CJ', has_variants: false, inventory_model: 'LEGACY_VARIANTS' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ variant_type: 'cj_size', variant_value: 'M' }] }),
    };

    await expect(activateProductSkuInventoryModel(db, 'p1'))
      .rejects.toMatchObject({ code: 'catalog_sku_cutover_not_ready' });

    expect(db.query.mock.calls.some(([sql]) => String(sql).includes("SET has_variants"))).toBe(false);
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
