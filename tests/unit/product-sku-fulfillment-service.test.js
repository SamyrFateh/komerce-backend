'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {
  adapterFromRegistry,
  loadProductSku,
  assessProductSkuFulfillment,
} = require('../../services/suppliers/product-sku-fulfillment-service');

function row(overrides = {}) {
  return {
    id: 'sku-1',
    product_id: 'prod-1',
    source: 'SUPPLIER',
    is_active: true,
    supplier_sku: 'AE-RED-M',
    supplier_product_ref: '10000012345',
    supplier_unit_ref: '20000098765',
    supplier_order_identity: {
      provider: 'aliexpress',
      version: 1,
      payload: { sku_id: '20000098765', sku_attr: '14:10;5:361386' },
    },
    ...overrides,
  };
}

function dbWith(value) {
  return { query: jest.fn(async () => ({ rows: value ? [value] : [] })) };
}

function readyAdapter() {
  return {
    provider: 'aliexpress',
    refresh: jest.fn(async () => ({
      available: true,
      stock_available: 9,
      unit_price: 3.2,
      currency: 'USD',
    })),
    preflight: jest.fn(async () => ({
      ready: true,
      shippable: true,
      freight_available: true,
    })),
  };
}

describe('product-sku fulfillment service', () => {
  test('charge uniquement le mapping fournisseur canonique depuis product_skus', async () => {
    const db = dbWith(row());
    const sku = await loadProductSku(db, 'sku-1');
    expect(sku.id).toBe('sku-1');
    expect(db.query).toHaveBeenCalledWith(expect.stringMatching(/supplier_product_ref/), ['sku-1']);
  });

  test('404 si le product_sku n’existe pas', async () => {
    await expect(loadProductSku(dbWith(null), 'missing')).rejects.toMatchObject({ status: 404 });
  });

  test('résout l’adapter par provider canonique', () => {
    const a = readyAdapter();
    expect(adapterFromRegistry(row(), { aliexpress: a })).toBe(a);
  });

  test('retourne FULFILLMENT_READY via le point d’entrée product_sku.id', async () => {
    const a = readyAdapter();
    const result = await assessProductSkuFulfillment(
      dbWith(row()),
      {
        productSkuId: 'sku-1',
        quantity: 2,
        destination: { country_code: 'KM' },
      },
      { adapters: { aliexpress: a } }
    );

    expect(result.verdict).toBe('FULFILLMENT_READY');
    expect(result.product_sku_id).toBe('sku-1');
    expect(a.refresh).toHaveBeenCalledTimes(1);
    expect(a.preflight).toHaveBeenCalledTimes(1);
  });

  test('SKU inactif est bloqué avant tout appel fournisseur', async () => {
    const a = readyAdapter();
    const result = await assessProductSkuFulfillment(
      dbWith(row({ is_active: false })),
      { productSkuId: 'sku-1', destination: { country_code: 'KM' } },
      { adapters: { aliexpress: a } }
    );

    expect(result.verdict).toBe('SKU_INACTIVE');
    expect(a.refresh).not.toHaveBeenCalled();
  });

  test('provider sans adapter reste fail-closed', async () => {
    const result = await assessProductSkuFulfillment(
      dbWith(row({ supplier_order_identity: { provider: 'unknown', version: 1, payload: { id: 'x' } } })),
      { productSkuId: 'sku-1', destination: { country_code: 'KM' } },
      { adapters: {} }
    );

    expect(result.verdict).toBe('SUPPLIER_UNAVAILABLE');
    expect(result.ready).toBe(false);
  });
});
