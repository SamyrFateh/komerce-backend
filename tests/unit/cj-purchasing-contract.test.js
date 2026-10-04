'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const contract = require('../../services/suppliers/cj-purchasing-contract');

const identity = {
  provider: 'cj',
  version: 1,
  payload: {
    pid: 'PID-1',
    vid: 'VID-1',
    variant_sku: 'SKU-1',
  },
};

function args(overrides = {}) {
  return {
    orderNumber: 'KOM-ORD-001',
    identity,
    quantity: 1,
    destination: {
      postal_code: '75001',
      country_code: 'FR',
      country: 'France',
      province: 'Ile-de-France',
      city: 'Paris',
      customer_name: 'Client Test',
      address1: '1 rue de Test',
      phone: '+33100000000',
    },
    logisticName: 'CJPacket',
    fromCountryCode: 'CN',
    storeLineItemId: 'ITEM-001',
    ...overrides,
  };
}

test('CJ contract — build createOrderV2 exact VID with create-only payType=3', () => {
  const payload = contract.buildCreateOrderV2Payload(args());

  expect(payload).toMatchObject({
    orderNumber: 'KOM-ORD-001',
    shippingCountryCode: 'FR',
    logisticName: 'CJPacket',
    fromCountryCode: 'CN',
    platform: 'komerce',
    payType: 3,
    products: [{
      vid: 'VID-1',
      quantity: 1,
      storeLineItemId: 'ITEM-001',
    }],
  });
  expect(payload).not.toHaveProperty('orderId');
  expect(payload).not.toHaveProperty('payment');
});

test('CJ contract — parse create response as created_unpaid, never committed', () => {
  const parsed = contract.parseCreateOrderResponse({
    result: true,
    data: {
      orderId: 'CJ-ORDER-1',
      orderNumber: 'KOM-ORD-001',
      shipmentOrderId: 'SHIP-1',
      productAmount: '10.00',
      postageAmount: '2.00',
    },
    requestId: 'REQ-1',
  });

  expect(parsed).toEqual({
    provider: 'cj',
    external_ref: 'CJ-ORDER-1',
    order_number: 'KOM-ORD-001',
    shipment_order_id: 'SHIP-1',
    product_amount: '10.00',
    postage_amount: '2.00',
    currency: 'USD',
    request_id: 'REQ-1',
    commitment_verdict: 'created_unpaid',
  });
});

test('CJ contract — exact SOI required', () => {
  expect(() => contract.buildCreateOrderV2Payload(args({
    identity: { provider: 'cj', version: 1, payload: { pid: 'P', variant_sku: 'S' } },
  }))).toThrow('CJ_VID_REQUIRED');

  expect(() => contract.buildCreateOrderV2Payload(args({
    identity: { provider: 'aliexpress', version: 1, payload: { pid: 'P', vid: 'V', variant_sku: 'S' } },
  }))).toThrow('CJ_IDENTITY_MISMATCH');
});

test.each([
  ['qty', { quantity: 0 }, 'CJ_QUANTITY_INVALID'],
  ['zip', { destination: { ...args().destination, postal_code: '' } }, 'CJ_SHIPPING_ZIP_REQUIRED'],
  ['country', { destination: { ...args().destination, country_code: '???' } }, 'CJ_SHIPPING_COUNTRY_CODE_REQUIRED'],
  ['logistic', { logisticName: '' }, 'CJ_LOGISTIC_NAME_REQUIRED'],
  ['origin', { fromCountryCode: '' }, 'CJ_FROM_COUNTRY_CODE_REQUIRED'],
])('CJ contract fail-closed — %s', (_label, override, code) => {
  expect(() => contract.buildCreateOrderV2Payload(args(override))).toThrow(code);
});

test('CJ contract — read-back query is exact CJ order id', () => {
  expect(contract.buildOrderDetailQuery('CJ-ORDER-1')).toEqual({ orderId: 'CJ-ORDER-1' });
  expect(() => contract.buildOrderDetailQuery('')).toThrow('CJ_ORDER_ID_REQUIRED');
});

test('CJ contract — create response without exact ids is rejected', () => {
  expect(() => contract.parseCreateOrderResponse({ result: false })).toThrow('CJ_CREATE_ORDER_REJECTED');
  expect(() => contract.parseCreateOrderResponse({ result: true, data: { orderNumber: 'KOM-1' } }))
    .toThrow('CJ_ORDER_ID_MISSING');
});
