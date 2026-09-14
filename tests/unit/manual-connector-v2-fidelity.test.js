'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { fetchProducts, normalizeFormItem } = require('../../services/suppliers/connectors/manual-connector');

describe('manual connector V2 fidelity', () => {
  test('préserve les champs descriptifs V2 utiles à la Resolution sans les interpréter', () => {
    const specifications = [
      { key: 'gtin', label: 'GTIN', value: '3560071499999' },
      { key: 'model', label: 'Model', value: 'KOM-PROOF-1' },
    ];
    const result = normalizeFormItem({
      product_name: 'Produit preuve multi-source',
      currency: 'EUR',
      brand: 'Komerce Proof',
      specifications,
      highlights: [{ key: 'proof', label: 'Identité contrôlée' }],
    }, 'Proof Supplier A');

    expect(result.schema_version).toBe('2');
    expect(result.brand).toBe('Komerce Proof');
    expect(result.specifications).toEqual(specifications);
    expect(result.specifications).not.toBe(specifications);
    expect(result.highlights).toEqual([{ key: 'proof', label: 'Identité contrôlée' }]);
  });

  test('accepte un V2 manuel portant un GTIN exploitable par le resolver universel', () => {
    const result = fetchProducts({
      supplier_name: 'Proof Supplier B',
      items: [{
        product_name: 'Produit preuve multi-source - source B',
        currency: 'USD',
        brand: 'Komerce Proof',
        specifications: [{ key: 'gtin', label: 'GTIN', value: '3560071499999' }],
      }],
    });

    expect(result.invalid).toHaveLength(0);
    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({
      schema_version: '2',
      brand: 'Komerce Proof',
      specifications: [{ key: 'gtin', label: 'GTIN', value: '3560071499999' }],
    });
  });
});
