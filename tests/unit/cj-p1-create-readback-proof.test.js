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
  expect(() => proof.guard({ DATABASE_URL: 'x', KOMERCE_ENV: 'staging' })).toThrow('KOMERCE_ALLOW_CJ_P1_CREATE_READBACK=1 requis');
});

test('CJ P1 guard refuse explicitement la production', () => {
  expect(() => proof.guard({
    DATABASE_URL: 'x',
    KOMERCE_ENV: 'production',
    KOMERCE_ALLOW_CJ_P1_CREATE_READBACK: '1',
  })).toThrow('CJ P1 create/read-back interdit en production');
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


test('CJ P1 utilise des defaults sandbox non sensibles si destination/logistique/origine absentes', () => {
  const e = {
    DATABASE_URL: 'postgres://test',
    KOMERCE_ALLOW_CJ_P1_CREATE_READBACK: '1',
    KOMERCE_ENV: 'staging',
  };
  expect(proof.parseDestination(e)).toMatchObject({
    country_code: 'US',
    country: 'United States',
    city: 'New York',
  });
});


test('CJ P1 lit le nouveau read-back CJ productList[].vid', () => {
  const facts = proof.readBackFacts({
    data: {
      orderId: 'CJ-2',
      orderNum: 'KOM-2',
      orderStatus: 'CREATED',
      productList: [{ vid: 'VID-2', quantity: 1, storeLineItemId: 'LINE-2' }],
    },
  });

  expect(facts).toMatchObject({
    order_id: 'CJ-2',
    order_number: 'KOM-2',
    status: 'CREATED',
    response_product_shape: 'productList[].vid',
    variants: [{ vid: 'VID-2', quantity: 1, store_line_item_id: 'LINE-2' }],
  });

  expect(proof.verifyReadBack({
    created: { external_ref: 'CJ-2', order_number: 'KOM-2' },
    detail: {
      data: {
        orderId: 'CJ-2',
        orderNum: 'KOM-2',
        orderStatus: 'CREATED',
        productList: [{ vid: 'VID-2', quantity: 1 }],
      },
    },
    expectedOrderNumber: 'KOM-2',
    expectedVid: 'VID-2',
    expectedQuantity: 1,
  })).toMatchObject({ response_product_shape: 'productList[].vid' });
});


test('CJ P1 reconnaît uniquement le code duplicate 1603003', () => {
  expect(proof.isDuplicateCreateError({ payload: { code: 1603003 } })).toBe(true);
  expect(proof.isDuplicateCreateError({ payload: { code: 1603002 } })).toBe(false);
  expect(proof.isDuplicateCreateError(new Error('Order exist'))).toBe(false);
});

test('CJ P1 récupère un ordre existant par orderNumber après duplicate', async () => {
  const calls = [];
  const call = jest.fn(async (path, opts) => {
    calls.push({ path, opts });
    if (path === '/api2.0/v1/shopping/order/createOrderV2') {
      const err = new Error('duplicate');
      err.payload = { code: 1603003, result: false, message: 'Order exist, please do not duplicate create' };
      throw err;
    }
    if (path === '/api2.0/v1/shopping/order/getOrderDetail') {
      expect(opts.query).toEqual({ orderId: 'KOM-P1-LINE-1' });
      return {
        result: true,
        data: {
          orderId: 'CJ-EXISTING-1',
          orderNum: 'KOM-P1-LINE-1',
          orderStatus: 'CREATED',
          productList: [{ vid: 'VID-1', quantity: 1 }],
        },
      };
    }
    throw new Error('unexpected call');
  });

  const recovered = await proof.resolveCreatedOrDuplicate({
    call,
    createPayload: { orderNumber: 'KOM-P1-LINE-1' },
    accessToken: 'token',
    orderNumber: 'KOM-P1-LINE-1',
  });

  expect(recovered.recovery).toBe('RECOVERED_AFTER_DUPLICATE');
  expect(recovered.created).toMatchObject({
    external_ref: 'CJ-EXISTING-1',
    order_number: 'KOM-P1-LINE-1',
    commitment_verdict: 'created_unpaid',
  });
  expect(calls).toHaveLength(2);
});
