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


test('CJ contract — duplicate signal is recognized only by native code 1603003', () => {
  expect(contract.isDuplicateCreateError({ payload: { code: 1603003 } })).toBe(true);
  expect(contract.isDuplicateCreateError({ payload: { code: 1603002 } })).toBe(false);
  expect(contract.isDuplicateCreateError(new Error('Order exist'))).toBe(false);
});

test('CJ contract — normalize productList[].vid and verify exact order/VID/quantity', () => {
  const detail = {
    result: true,
    data: {
      orderId: 'CJ-ORDER-1',
      orderNum: 'KOM-ORD-001',
      orderStatus: 'CREATED',
      productList: [{ vid: 'VID-1', quantity: 1, storeLineItemId: 'ITEM-001' }],
    },
  };

  expect(contract.readOrderDetailFacts(detail)).toMatchObject({
    order_id: 'CJ-ORDER-1',
    order_number: 'KOM-ORD-001',
    status: 'CREATED',
    response_product_shape: 'productList[].vid',
    variants: [{ vid: 'VID-1', quantity: 1, store_line_item_id: 'ITEM-001' }],
  });

  expect(contract.verifyOrderDetail({
    created: { external_ref: 'CJ-ORDER-1', order_number: 'KOM-ORD-001' },
    detail,
    expectedOrderNumber: 'KOM-ORD-001',
    expectedVid: 'VID-1',
    expectedQuantity: 1,
  })).toMatchObject({
    order_id: 'CJ-ORDER-1',
    order_number: 'KOM-ORD-001',
    status: 'CREATED',
  });
});

test('CJ contract — read-back mismatch and committed status fail closed', () => {
  const base = {
    result: true,
    data: {
      orderId: 'CJ-ORDER-1',
      orderNum: 'KOM-ORD-001',
      orderStatus: 'CREATED',
      productList: [{ vid: 'VID-1', quantity: 1 }],
    },
  };

  expect(() => contract.verifyOrderDetail({
    created: { external_ref: 'CJ-ORDER-1', order_number: 'KOM-ORD-001' },
    detail: base,
    expectedOrderNumber: 'KOM-ORD-001',
    expectedVid: 'OTHER-VID',
    expectedQuantity: 1,
  })).toThrow('CJ_READBACK_VARIANT_MISMATCH');

  expect(() => contract.verifyOrderDetail({
    created: { external_ref: 'CJ-ORDER-1', order_number: 'KOM-ORD-001' },
    detail: { ...base, data: { ...base.data, orderStatus: 'PAID' } },
    expectedOrderNumber: 'KOM-ORD-001',
    expectedVid: 'VID-1',
    expectedQuantity: 1,
  })).toThrow('CJ_UNEXPECTED_ORDER_STATUS:PAID');
});


test('CJ contract — confirmOrder vérifie strictement le même orderId', () => {
  expect(contract.buildConfirmOrderPayload('CJ-1')).toEqual({ orderId: 'CJ-1' });
  expect(contract.parseConfirmOrderResponse({
    result: true,
    data: 'CJ-1',
    requestId: 'REQ-C',
  }, 'CJ-1')).toMatchObject({
    provider: 'cj',
    order_id: 'CJ-1',
    confirmation_verdict: 'confirmed_unpaid',
  });
  expect(() => contract.parseConfirmOrderResponse({
    result: true,
    data: 'CJ-2',
  }, 'CJ-1')).toThrow('CJ_CONFIRM_ORDER_ID_MISMATCH');
});

test('CJ contract — payBalanceV2 exige shipmentOrderId et accepte payId optionnel', () => {
  expect(contract.buildPayBalanceV2Payload('SHIP-1')).toEqual({
    shipmentOrderId: 'SHIP-1',
  });
  expect(contract.buildPayBalanceV2Payload('SHIP-1', 'PAY-1')).toEqual({
    shipmentOrderId: 'SHIP-1',
    payId: 'PAY-1',
  });
  expect(contract.parsePayBalanceV2Response({
    result: true,
    data: null,
    requestId: 'REQ-P',
  })).toMatchObject({
    provider: 'cj',
    payment_verdict: 'paid',
  });
});

test('CJ contract — read-back financier refuse UNPAID après paiement', () => {
  expect(contract.verifyPaidOrderDetail({
    data: { orderId: 'CJ-1', orderStatus: 'PENDING', productList: [] },
  }, 'CJ-1')).toMatchObject({ order_id: 'CJ-1', status: 'PENDING' });

  expect(() => contract.verifyPaidOrderDetail({
    data: { orderId: 'CJ-1', orderStatus: 'UNPAID', productList: [] },
  }, 'CJ-1')).toThrow('CJ_PAID_STATUS_UNEXPECTED:UNPAID');
});


test('CJ contract — read-back expose shipmentOrderId quand createOrderV2 ne le renvoie pas', () => {
  expect(contract.readOrderDetailFacts({
    data: {
      orderId: 'CJ-1',
      orderNum: 'KOM-1',
      shipmentOrderId: 'SHIP-1',
      orderStatus: 'CREATED',
      productList: [{ vid: 'VID-1', quantity: 1 }],
    },
  })).toMatchObject({
    order_id: 'CJ-1',
    order_number: 'KOM-1',
    shipment_order_id: 'SHIP-1',
  });
});
