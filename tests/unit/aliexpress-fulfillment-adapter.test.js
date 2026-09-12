'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {
  createAliExpressFulfillmentAdapter,
} = require('../../services/suppliers/adapters/aliexpress-fulfillment-adapter');

function mapping(overrides = {}) {
  return {
    product_sku_id: 'sku-1',
    product_id: 'prod-1',
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

function liveContract(overrides = {}) {
  return {
    schema_version: '2',
    supplier_name: 'AliExpress',
    supplier_product_id: '10000012345',
    currency: 'USD',
    sellable_units: [{
      supplier_sku: 'AE-RED-M',
      supplier_unit_ref: '20000098765',
      supplier_order_identity: {
        provider: 'aliexpress',
        version: 1,
        payload: { sku_id: '20000098765', sku_attr: '14:10;5:361386' },
      },
      stock_available: 8,
      purchase_price: 3.21,
      currency: 'USD',
      is_active: true,
    }],
    ...overrides,
  };
}

function deps(contract = liveContract(), freightPayload = { result: { success: true, result: [{ service_name: 'TEST' }] } }) {
  const connectedImpl = {
    managedRuntimeEnv: jest.fn(async () => ({ ALIEXPRESS_SESSION: 'session' })),
    fetchProducts: jest.fn(async () => ({ products: [contract] })),
    invokeTop: jest.fn(async () => freightPayload),
  };
  const preflightImpl = {
    METHODS: { FREIGHT: 'freight.method' },
    resolveOrderableUnit: jest.fn((c, supplierSku, quantity) => {
      const u = c.sellable_units.find((item) => item.supplier_sku === supplierSku);
      return {
        supplier_product_id: c.supplier_product_id,
        supplier_sku: u.supplier_sku,
        supplier_unit_ref: u.supplier_unit_ref,
        supplier_order_identity: u.supplier_order_identity,
        stock_available: u.stock_available,
        unit_price: u.purchase_price,
        currency: u.currency,
        quantity,
        raw_sku_id: u.supplier_order_identity.payload.sku_id,
        sku_attr: u.supplier_order_identity.payload.sku_attr,
      };
    }),
    buildFreightBusinessParams: jest.fn(() => ({ dto: 'x' })),
    summarizeFreightResponse: jest.fn(() => ({ success: true, has_options: true, error: null })),
    classifyApiError: jest.fn(() => 'other'),
  };
  return { connectedImpl, preflightImpl };
}

describe('AliExpress fulfillment adapter', () => {
  test('refresh résout l’unité par supplier_unit_ref persisté, pas par label humain', async () => {
    const d = deps();
    const adapter = createAliExpressFulfillmentAdapter(d);
    const live = await adapter.refresh(mapping(), { quantity: 2, destination: { country_code: 'KM' } });
    expect(d.connectedImpl.fetchProducts).toHaveBeenCalledWith(expect.objectContaining({
      productIds: ['10000012345'],
      countryCode: 'KM',
    }));
    expect(d.preflightImpl.resolveOrderableUnit).toHaveBeenCalledWith(
      expect.any(Object), 'AE-RED-M', 2, { requireOrderIdentity: true }
    );
    expect(live.stock_available).toBe(8);
  });

  test('bloque si la supplier_unit_ref persistée ne résout aucune unité live', async () => {
    const d = deps(liveContract({ sellable_units: [] }));
    const adapter = createAliExpressFulfillmentAdapter(d);
    await expect(adapter.refresh(mapping(), { quantity: 1, destination: { country_code: 'KM' } }))
      .rejects.toMatchObject({ code: 'BLOCKED_SUPPLIER_IDENTITY' });
  });

  test('bloque tout remap silencieux de Supplier Order Identity', async () => {
    const c = liveContract();
    c.sellable_units[0].supplier_order_identity = {
      provider: 'aliexpress', version: 1, payload: { sku_id: 'DIFFERENT', sku_attr: 'x' },
    };
    const d = deps(c);
    const adapter = createAliExpressFulfillmentAdapter(d);
    await expect(adapter.refresh(mapping(), { quantity: 1, destination: { country_code: 'KM' } }))
      .rejects.toMatchObject({ code: 'BLOCKED_SUPPLIER_IDENTITY' });
  });

  test('preflight ne prépare que le fret et n’appelle jamais placeOrder', async () => {
    const d = deps();
    const adapter = createAliExpressFulfillmentAdapter(d);
    const live = await adapter.refresh(mapping(), { quantity: 1, destination: { country_code: 'KM' } });
    const result = await adapter.preflight(mapping(), live, { quantity: 1, destination: { country_code: 'KM' } });
    expect(result).toEqual(expect.objectContaining({ ready: true, freight_available: true }));
    expect(d.connectedImpl.invokeTop).toHaveBeenCalledWith('freight.method', { dto: 'x' }, expect.any(Object));
    expect(d.connectedImpl.invokeTop).toHaveBeenCalledTimes(1);
  });
});
