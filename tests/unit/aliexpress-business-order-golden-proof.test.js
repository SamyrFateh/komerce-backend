'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../db', () => ({ query: jest.fn(), pool: { end: jest.fn() } }));

const proof = require('../../scripts/aliexpress-business-order-golden-proof');

const SKU_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';
const UNIT_REF = '12000052119244345';
const IDENTITY = {
  provider: 'aliexpress',
  version: 1,
  payload: { product_id: '1005010358671233', sku_id: UNIT_REF, sku_attr: '14:Beige' },
};

function env() {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://test',
    ALIEXPRESS_APP_KEY: 'key',
    ALIEXPRESS_APP_SECRET: 'secret',
    ALIEXPRESS_TOKEN_ENCRYPTION_KEY: 'enc',
    KOMERCE_ALLOW_ALIEXPRESS_ORDER_PROOF: '1',
    KOMERCE_ALIEXPRESS_ORDER_PROOF_DESTINATION_JSON: JSON.stringify({
      address1: 'Hub Test',
      city: 'Dubai',
      country_code: 'AE',
      province: 'Dubai',
      postal_code: '00000',
      customer_name: 'Komerce Hub',
      phone: '+971500000000',
    }),
  };
}

function query() {
  return jest.fn(async () => ({
    rows: [{
      id: SKU_ID,
      product_id: PRODUCT_ID,
      supplier_sku: 'ALI-SKU',
      supplier_unit_ref: UNIT_REF,
      supplier_order_identity: IDENTITY,
    }],
  }));
}

function verdict() {
  return {
    status: 'FULFILLMENT_READY',
    ready: true,
    provider: 'aliexpress',
    canonical_unit_id: '33333333-3333-4333-8333-333333333333',
    canonical_unit: { current_state: { stock_available: 2, purchase_price: 3.19, currency: 'USD' } },
    supplier_unit_ref: UNIT_REF,
    identity: IDENTITY,
    money: { unit_price: 3.19, currency: 'USD' },
    place_order_invoked: false,
    preflight: {
      ready: true,
      evidence: {
        provider: 'aliexpress',
        supplier_unit_ref: UNIT_REF,
        supplier_product_id: '1005010358671233',
        stock_available: 2,
        unit_price: 3.19,
        currency: 'USD',
        supplier_origin_country_code: 'CN',
        destination_country_code: 'AE',
        exact_unit_resolved: true,
        freight: { success: true, has_options: true, service_name: 'CAINIAO_STD' },
        auto_order_ready: true,
        place_order_invoked: false,
        payment_invoked: false,
      },
    },
  };
}

test('Golden business — readiness puis une création non payée et read-back exact', async () => {
  const buildOrderPayload = jest.fn(async () => ({ provider: 'aliexpress', native: { x: 1 } }));
  const placeOrder = jest.fn(async () => ({
    supplier_order_id: '123456789',
    supplier_order_ids: ['123456789'],
    commitment_verdict: 'created_unpaid',
    execution_recovery: 'CREATED_NOW_NO_NATIVE_IDEMPOTENCY',
    readback_status: 'PLACE_ORDER_SUCCESS',
    readback_orders: [{ order_id: '123456789', status: 'PLACE_ORDER_SUCCESS' }],
    payment_invoked: false,
  }));
  const adapters = { aliexpress: { buildOrderPayload, placeOrder } };
  const readiness = jest.fn(async () => verdict());

  const report = await proof.run([SKU_ID], {
    env: env(),
    query: query(),
    readiness,
    adapters,
  });

  expect(readiness).toHaveBeenCalledWith(expect.objectContaining({
    productSkuId: SKU_ID,
    quantity: 1,
    soldIdentity: IDENTITY,
    context: expect.objectContaining({ aliexpress_execution_authorized: true }),
  }));
  expect(buildOrderPayload).toHaveBeenCalledTimes(1);
  expect(placeOrder).toHaveBeenCalledTimes(1);
  expect(report).toMatchObject({
    status: 'PASS',
    proof: 'ALIEXPRESS_BUSINESS_ORDER_CREATE_READBACK',
    supplier_order_id: '123456789',
    commitment_verdict: 'created_unpaid',
    mutation: { place_order_invoked: true, payment_invoked: false },
  });
});

test('fail-closed — production, flag absent, destination invalide et payment jamais accepté', async () => {
  expect(() => proof.guard({
    NODE_ENV: 'production',
    DATABASE_URL: 'x',
    KOMERCE_ALLOW_ALIEXPRESS_ORDER_PROOF: '1',
  })).toThrow('interdit en production');

  expect(() => proof.guard({
    NODE_ENV: 'test',
    DATABASE_URL: 'x',
    ALIEXPRESS_APP_KEY: 'k',
    ALIEXPRESS_APP_SECRET: 's',
    ALIEXPRESS_TOKEN_ENCRYPTION_KEY: 'e',
  })).toThrow('KOMERCE_ALLOW_ALIEXPRESS_ORDER_PROOF=1 requis');

  expect(() => proof.parseDestination({
    KOMERCE_ALIEXPRESS_ORDER_PROOF_DESTINATION_JSON: '{bad',
  }, { normalizePlaceOrderAddress: jest.fn() })).toThrow('DESTINATION_JSON_INVALID');

  const badPay = {
    buildOrderPayload: jest.fn(async () => ({ provider: 'aliexpress', native: {} })),
    placeOrder: jest.fn(async () => ({
      supplier_order_id: '123456789',
      supplier_order_ids: ['123456789'],
      commitment_verdict: 'created_unpaid',
      readback_orders: [{ order_id: '123456789' }],
      payment_invoked: true,
    })),
  };
  await expect(proof.run([SKU_ID], {
    env: env(),
    query: query(),
    readiness: jest.fn(async () => verdict()),
    adapters: { aliexpress: badPay },
  })).rejects.toThrow('ALIEXPRESS_ORDER_PROOF_PAYMENT_MUST_BE_FALSE');
});
