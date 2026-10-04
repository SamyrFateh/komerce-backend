'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../services/suppliers/connectors/cj-connector', () => ({
  BASE_URL: 'https://developers.cjdropshipping.com/api2.0/v1',
  fetchProducts: jest.fn(),
  getAccessToken: jest.fn(),
}));

const connector = require('../../services/suppliers/connectors/cj-connector');
const adapter = require('../../services/suppliers/cj-fulfillment-adapter');

const identity = {
  provider: 'cj',
  version: 1,
  payload: { pid: 'PID-1', vid: 'VID-1', variant_sku: 'SKU-1' },
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('evaluate prouve l unité CJ exacte avec stock et prix live', async () => {
  connector.fetchProducts.mockResolvedValue({
    products: [{
      sellable_units: [{
        supplier_unit_ref: 'VID-1',
        supplier_sku: 'SKU-1',
        stock_available: 7,
        purchase_price: 12.5,
        currency: 'USD',
        is_active: true,
      }],
    }],
    invalid: [],
  });

  const verdict = await adapter.evaluate({
    row: { supplier_unit_ref: 'VID-1' },
    identity,
    quantity: 2,
    context: {},
  });

  expect(verdict).toMatchObject({
    ready: true,
    status: 'FULFILLMENT_READY',
    evidence: {
      provider: 'cj',
      exact_unit_resolved: true,
      live_stock_checked: true,
      live_price_checked: true,
      auto_order_ready: true,
      stock_available: 7,
      unit_price: 12.5,
      currency: 'USD',
    },
  });
});

test('buildOrderPayload garde la SOI opaque et exige destination/logistique explicites', async () => {
  const payload = await adapter.buildOrderPayload({
    items: [{ identity, supplier_unit_ref: 'VID-1', quantity: 1 }],
    preflights: [{ ready: true, evidence: { auto_order_ready: true } }],
    context: {
      order_number: 'KOM-PO-1',
      procurement_destination: {
        postal_code: '10001',
        country_code: 'US',
        country: 'United States',
        province: 'New York',
        city: 'New York',
        customer_name: 'Komerce Hub',
        address1: '350 5th Ave',
        phone: '2127363100',
      },
      logistic_name: 'CJPacket',
      from_country_code: 'CN',
      store_line_item_id: 'LINE-1',
      sandbox: true,
    },
  });

  expect(payload).toMatchObject({
    provider: 'cj',
    sandbox: true,
    expected: { order_number: 'KOM-PO-1', vid: 'VID-1', quantity: 1 },
    native: {
      orderNumber: 'KOM-PO-1',
      payType: 3,
      isSandbox: 1,
      products: [{ vid: 'VID-1', quantity: 1, storeLineItemId: 'LINE-1' }],
    },
  });
});

test('placeOrder récupère un duplicate sans seconde création et vérifie le read-back exact', async () => {
  connector.getAccessToken.mockResolvedValue('token');
  const invoke = jest.fn()
    .mockRejectedValueOnce(Object.assign(new Error('duplicate'), {
      payload: { code: 1603003, result: false, message: 'Order exist, please do not duplicate create' },
    }))
    .mockResolvedValueOnce({
      result: true,
      data: {
        orderId: 'CJ-1',
        orderNum: 'KOM-PO-1',
        orderStatus: 'CREATED',
        cjOrderCode: 'SD-1',
        productList: [{ vid: 'VID-1', quantity: 1 }],
      },
    });

  const out = await adapter.placeOrder({
    provider: 'cj',
    native: { orderNumber: 'KOM-PO-1', payType: 3, products: [{ vid: 'VID-1', quantity: 1 }] },
    expected: { order_number: 'KOM-PO-1', vid: 'VID-1', quantity: 1 },
    sandbox: true,
  }, {
    cj_execution_authorized: true,
    invoke,
  });

  expect(out).toMatchObject({
    supplier_order_id: 'CJ-1',
    supplier_order_code: 'SD-1',
    execution_recovery: 'RECOVERED_AFTER_DUPLICATE',
    exact_vid_verified: true,
    exact_quantity_verified: true,
    payment_invoked: false,
    confirmation_invoked: false,
  });
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(invoke.mock.calls[1][1].query).toEqual({ orderId: 'KOM-PO-1' });
});

test('placeOrder refuse toute exécution sans autorisation explicite', async () => {
  await expect(adapter.placeOrder({
    provider: 'cj',
    native: {},
    expected: {},
  }, {})).rejects.toThrow('CJ_EXECUTION_NOT_AUTHORIZED');
  expect(connector.getAccessToken).not.toHaveBeenCalled();
});


test('buildOrderPayload dérive orderNumber et logistique depuis le contexte runtime canonique', async () => {
  const payload = await adapter.buildOrderPayload({
    items: [{ identity, supplier_unit_ref: 'VID-1', quantity: 1 }],
    preflights: [{ ready: true, evidence: { auto_order_ready: true } }],
    context: {
      execution_key: '00000000-0000-0000-0000-000000000201',
      procurement_destination: {
        postal_code: '00000',
        country_code: 'AE',
        country: 'United Arab Emirates',
        province: 'Dubai',
        city: 'Dubai',
        customer_name: 'Komerce Hub',
        address1: 'Hub address',
        phone: '+971000000000',
      },
      store_line_item_id: 'line-1',
      env: {
        KOMERCE_CJ_LOGISTIC_NAME: 'CJPacket',
        KOMERCE_CJ_FROM_COUNTRY_CODE: 'CN',
      },
    },
  });

  expect(payload.native).toMatchObject({
    orderNumber: 'KOM-PO-00000000-0000-0000-0000-000000000201',
    logisticName: 'CJPacket',
    fromCountryCode: 'CN',
    payType: 3,
    products: [{ vid: 'VID-1', quantity: 1, storeLineItemId: 'line-1' }],
  });
});

test('placeOrder autorisation runtime reste derrière le flag explicite CJ', async () => {
  connector.getAccessToken.mockResolvedValue('token');
  const invoke = jest.fn()
    .mockResolvedValueOnce({
      result: true,
      data: { orderId: 'CJ-2', orderNumber: 'KOM-PO-2' },
    })
    .mockResolvedValueOnce({
      result: true,
      data: {
        orderId: 'CJ-2',
        orderNum: 'KOM-PO-2',
        orderStatus: 'CREATED',
        productList: [{ vid: 'VID-1', quantity: 1 }],
      },
    });

  const out = await adapter.placeOrder({
    provider: 'cj',
    native: { orderNumber: 'KOM-PO-2', payType: 3, products: [{ vid: 'VID-1', quantity: 1 }] },
    expected: { order_number: 'KOM-PO-2', vid: 'VID-1', quantity: 1 },
  }, {
    env: { KOMERCE_CJ_AUTO_ORDER_ENABLED: '1' },
    invoke,
  });

  expect(out.supplier_order_id).toBe('CJ-2');
  expect(out.payment_invoked).toBe(false);
  expect(out.confirmation_invoked).toBe(false);
});


test('buildOrderPayload peut activer le sandbox CJ uniquement par flag runtime explicite', async () => {
  const payload = await adapter.buildOrderPayload({
    items: [{ identity, supplier_unit_ref: 'VID-1', quantity: 1 }],
    preflights: [{ ready: true, evidence: { auto_order_ready: true } }],
    context: {
      execution_key: 'po-sandbox-1',
      procurement_destination: {
        postal_code: '10001',
        country_code: 'US',
        country: 'United States',
        province: 'New York',
        city: 'New York',
        customer_name: 'Komerce Sandbox',
        address1: '350 5th Ave',
        phone: '2127363100',
      },
      env: {
        KOMERCE_CJ_LOGISTIC_NAME: 'CJPacket',
        KOMERCE_CJ_FROM_COUNTRY_CODE: 'CN',
        KOMERCE_CJ_SANDBOX: '1',
      },
    },
  });

  expect(payload.sandbox).toBe(true);
  expect(payload.native.isSandbox).toBe(1);
  expect(payload.native.payType).toBe(3);
});

test('buildOrderPayload ne suppose jamais sandbox sans flag explicite', async () => {
  const payload = await adapter.buildOrderPayload({
    items: [{ identity, supplier_unit_ref: 'VID-1', quantity: 1 }],
    preflights: [{ ready: true, evidence: { auto_order_ready: true } }],
    context: {
      execution_key: 'po-prod-shaped-1',
      procurement_destination: {
        postal_code: '10001',
        country_code: 'US',
        country: 'United States',
        province: 'New York',
        city: 'New York',
        customer_name: 'Komerce Hub',
        address1: '350 5th Ave',
        phone: '2127363100',
      },
      env: {
        KOMERCE_CJ_LOGISTIC_NAME: 'CJPacket',
        KOMERCE_CJ_FROM_COUNTRY_CODE: 'CN',
      },
    },
  });

  expect(payload.sandbox).toBe(false);
  expect(payload.native.isSandbox).toBeUndefined();
});


test('buildOrderPayload utilise platform Api par défaut comme le P1 prouvé', async () => {
  const payload = await adapter.buildOrderPayload({
    items: [{ identity, supplier_unit_ref: 'VID-1', quantity: 1 }],
    preflights: [{ ready: true, evidence: { auto_order_ready: true } }],
    context: {
      execution_key: 'po-1',
      procurement_destination: {
        postal_code: '10001',
        country_code: 'US',
        country: 'United States',
        province: 'New York',
        city: 'New York',
        customer_name: 'Komerce Sandbox',
        address1: '350 5th Ave',
        phone: '2127363100',
      },
      env: {
        KOMERCE_CJ_LOGISTIC_NAME: 'CJPacket',
        KOMERCE_CJ_FROM_COUNTRY_CODE: 'CN',
        KOMERCE_CJ_SANDBOX: '1',
      },
    },
  });

  expect(payload.native.platform).toBe('Api');
});

test('buildOrderPayload accepte un override platform explicite sans branche provider dans le core', async () => {
  const payload = await adapter.buildOrderPayload({
    items: [{ identity, supplier_unit_ref: 'VID-1', quantity: 1 }],
    preflights: [{ ready: true, evidence: { auto_order_ready: true } }],
    context: {
      execution_key: 'po-2',
      platform: 'Custom',
      procurement_destination: {
        postal_code: '10001',
        country_code: 'US',
        country: 'United States',
        province: 'New York',
        city: 'New York',
        customer_name: 'Komerce Sandbox',
        address1: '350 5th Ave',
        phone: '2127363100',
      },
      env: {
        KOMERCE_CJ_LOGISTIC_NAME: 'CJPacket',
        KOMERCE_CJ_FROM_COUNTRY_CODE: 'CN',
      },
    },
  });

  expect(payload.native.platform).toBe('Custom');
});
