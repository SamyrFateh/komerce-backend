'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../db', () => ({ query: jest.fn(), pool: { end: jest.fn() } }));
jest.mock('../../services/suppliers/connectors/cj-connector', () => ({
  BASE_URL: 'https://developers.cjdropshipping.com/api2.0/v1',
  getAccessToken: jest.fn(async () => 'token'),
}));

const proof = require('../../scripts/cj-p1-create-readback-proof');

const identity = {
  provider: 'cj',
  version: 1,
  payload: { pid: 'PID-1', vid: 'VID-1', variant_sku: 'SKU-1' },
};

function env() {
  return {
    DATABASE_URL: 'postgres://test',
    KOMERCE_ALLOW_CJ_P1_CREATE_READBACK: '1',
    KOMERCE_CJ_P1_PRODUCT_REF: 'KPR-131962',
    KOMERCE_CJ_P1_LOGISTIC_NAME: 'CJPacket',
    KOMERCE_CJ_P1_FROM_COUNTRY_CODE: 'CN',
    KOMERCE_CJ_P1_DESTINATION_JSON: JSON.stringify({
      postal_code: '00000',
      country_code: 'US',
      country: 'United States',
      province: 'Test',
      city: 'Test',
      customer_name: 'Komerce Sandbox',
      address1: 'Sandbox address',
      phone: '0000000000',
    }),
  };
}

test('CJ P1 guard exige le flag explicite', () => {
  expect(() => proof.guard({ DATABASE_URL: 'x' })).toThrow('KOMERCE_ALLOW_CJ_P1_CREATE_READBACK=1 requis');
});

test('CJ P1 vérifie exactement order + VID + quantité + statut non payé', () => {
  const created = { external_ref: 'CJ-1', order_number: 'KOM-1' };
  const detail = {
    data: {
      orderId: 'CJ-1',
      orderNum: 'KOM-1',
      orderStatus: 'CREATED',
      productInfoList: [{ variantId: 'VID-1', quantity: 1 }],
    },
  };
  expect(proof.verifyReadBack({
    created, detail, expectedOrderNumber: 'KOM-1', expectedVid: 'VID-1', expectedQuantity: 1,
  })).toMatchObject({ status: 'CREATED' });
});

test('CJ P1 échoue si le VID read-back diverge', () => {
  expect(() => proof.verifyReadBack({
    created: { external_ref: 'CJ-1', order_number: 'KOM-1' },
    detail: { data: { orderId: 'CJ-1', orderStatus: 'CREATED', productInfoList: [{ variantId: 'OTHER', quantity: 1 }] } },
    expectedOrderNumber: 'KOM-1', expectedVid: 'VID-1', expectedQuantity: 1,
  })).toThrow('CJ_P1_READBACK_VARIANT_MISMATCH');
});

test('CJ P1 run crée uniquement sandbox payType=3 puis read-back', async () => {
  const calls = [];
  const invoke = jest.fn(async (path, options) => {
    calls.push({ path, options });
    if (options.method === 'POST') {
      return {
        result: true,
        data: {
          orderId: 'CJ-ORDER-1',
          orderNumber: 'KOM-P1-SKU-ID',
          shipmentOrderId: 'SHIP-1',
        },
      };
    }
    return {
      result: true,
      data: {
        orderId: 'CJ-ORDER-1',
        orderNum: 'KOM-P1-SKU-ID',
        orderStatus: 'CREATED',
        productInfoList: [{ variantId: 'VID-1', quantity: 1 }],
      },
    };
  });

  const result = await proof.run(env(), {
    selectExactSku: async () => ({
      product_ref: 'KPR-131962',
      product_sku_id: 'SKU-ID',
      supplier_sku: 'SKU-1',
      supplier_unit_ref: 'VID-1',
      supplier_order_identity: identity,
      stock: 9,
    }),
    invoke,
  });

  expect(calls).toHaveLength(2);
  expect(calls[0].options.body).toMatchObject({
    payType: 3,
    isSandbox: 1,
    products: [{ vid: 'VID-1', quantity: 1, storeLineItemId: 'SKU-ID' }],
  });
  expect(calls[1].options.method).toBe('GET');
  expect(result).toMatchObject({
    sandbox: true,
    payment_invoked: false,
    confirmation_invoked: false,
    exact_vid_verified: true,
    exact_quantity_verified: true,
    commitment_verdict: 'created_unpaid',
  });
});
