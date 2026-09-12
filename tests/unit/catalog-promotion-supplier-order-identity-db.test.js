'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { makeClient } = require('../integration/test-harness/mock-db');
const { promoteCatalog } = require('../../services/catalog-promotion');
const { BLOCKED_SUPPLIER_IDENTITY } = require('../../services/suppliers/supplier-order-identity');

const IDENTITY = {
  provider: 'aliexpress',
  version: 1,
  payload: { sku_id: 'UNIT-1', sku_attr: '14:29;5:361386' },
};

function contract(overrides = {}) {
  return {
    schema_version: '2',
    product_name: 'Produit test',
    supplier_name: 'AliExpress',
    currency: 'USD',
    media: [],
    option_axes: [],
    sellable_units: [{
      supplier_sku: 'SUP-1',
      supplier_unit_ref: 'UNIT-1',
      supplier_order_identity: IDENTITY,
      option_values: {},
      stock_available: 8,
    }],
    ...overrides,
  };
}

function contentMocks() {
  return [
    { rows: [{ id: 'profile-1' }] },
    { rows: [], rowCount: 0 },
    { rows: [], rowCount: 0 },
  ];
}

describe('catalog promotion — Supplier Order Identity DB path', () => {
  test('new SKU persists supplier_unit_ref and supplier_order_identity', async () => {
    const client = makeClient([
      { rows: [] },
      { rows: [{ id: 'sku-1', supplier_sku: 'SUP-1' }] },
      ...contentMocks(),
    ]);

    const result = await promoteCatalog(client, {
      productId: 'prod-1',
      normalizedSourceContract: contract(),
    });

    expect(result.skus).toEqual({ count: 1 });
    expect(client.calls[0].sql).toMatch(/SELECT id, supplier_sku, source, variant_combo, stock, is_active/);
    expect(client.calls[1].sql).toMatch(/supplier_unit_ref/);
    expect(client.calls[1].sql).toMatch(/supplier_order_identity/);
    expect(client.calls[1].params).toEqual([
      'prod-1',
      'SUP-1',
      'UNIT-1',
      JSON.stringify(IDENTITY),
      JSON.stringify({}),
      8,
    ]);
  });

  test('historical SKU can be completed from a native identity replay', async () => {
    const client = makeClient([
      { rows: [{
        id: 'sku-1', supplier_sku: 'SUP-1', source: 'SUPPLIER',
        variant_combo: {}, stock: 5, is_active: true,
      }] },
      { rows: [{ id: 'sku-1', supplier_unit_ref: null, supplier_order_identity: null }] },
      { rows: [] },
      ...contentMocks(),
    ]);

    await promoteCatalog(client, {
      productId: 'prod-1',
      normalizedSourceContract: contract(),
    });

    expect(client.calls[1].sql).toMatch(/SELECT id, supplier_unit_ref, supplier_order_identity/);
    expect(client.calls[2].sql).toMatch(/SET supplier_unit_ref = \$1/);
    expect(client.calls[2].params[0]).toBe('UNIT-1');
    expect(client.calls[2].params[1]).toBe(JSON.stringify(IDENTITY));
  });

  test('conflicting persisted identity blocks before any SKU write', async () => {
    const client = makeClient([
      { rows: [{
        id: 'sku-1', supplier_sku: 'SUP-1', source: 'SUPPLIER',
        variant_combo: {}, stock: 5, is_active: true,
      }] },
      { rows: [{
        id: 'sku-1',
        supplier_unit_ref: 'UNIT-OLD',
        supplier_order_identity: {
          provider: 'aliexpress', version: 1, payload: { sku_id: 'UNIT-OLD' },
        },
      }] },
    ]);

    let error;
    try {
      await promoteCatalog(client, {
        productId: 'prod-1',
        normalizedSourceContract: contract(),
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeTruthy();
    expect(error.code).toBe(BLOCKED_SUPPLIER_IDENTITY);
    expect(client.calls).toHaveLength(2);
  });
});
