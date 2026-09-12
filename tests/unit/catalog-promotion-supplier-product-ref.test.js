'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { makeClient } = require('../integration/test-harness/mock-db');
const { _persistSupplierProductRef } = require('../../services/catalog-promotion');

describe('catalog promotion — supplier_product_ref', () => {
  test('complète une référence absente depuis le contrat V2 autoritatif', async () => {
    const client = makeClient([
      { rows: [{ id: 'sku-1', supplier_product_ref: null }] },
      { rows: [], rowCount: 1 },
    ]);

    const result = await _persistSupplierProductRef(client, 'prod-1', '10000012345');

    expect(result).toEqual({ applied: true, supplier_product_ref: '10000012345', updated: 1 });
    expect(client.calls[0].sql).toMatch(/SELECT id, supplier_product_ref\s+FROM product_skus/i);
    expect(client.calls[1].sql).toMatch(/SET supplier_product_ref = \$1/i);
    expect(client.calls[1].params).toEqual(['10000012345', 'prod-1']);
  });

  test('replay idempotent : la même référence est conservée', async () => {
    const client = makeClient([
      { rows: [{ id: 'sku-1', supplier_product_ref: '10000012345' }] },
      { rows: [], rowCount: 0 },
    ]);

    await expect(_persistSupplierProductRef(client, 'prod-1', '10000012345')).resolves.toEqual(
      expect.objectContaining({ applied: true, updated: 0 })
    );
  });

  test('bloque tout remap silencieux de référence produit fournisseur', async () => {
    const client = makeClient([
      { rows: [{ id: 'sku-1', supplier_product_ref: '10000012345' }] },
    ]);

    await expect(_persistSupplierProductRef(client, 'prod-1', '99999999999'))
      .rejects.toMatchObject({ code: 'BLOCKED_SUPPLIER_IDENTITY' });
    expect(client.calls).toHaveLength(1);
  });

  test('contrat historique sans supplier_product_id : aucune écriture, aucune inférence', async () => {
    const client = makeClient([]);
    await expect(_persistSupplierProductRef(client, 'prod-1', null)).resolves.toEqual({
      applied: false,
      reason: 'missing_in_contract',
    });
    expect(client.calls).toHaveLength(0);
  });
});
