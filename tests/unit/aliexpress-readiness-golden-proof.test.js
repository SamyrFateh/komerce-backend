'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../db', () => ({ query: jest.fn(), pool: { end: jest.fn() } }));

const proof = require('../../scripts/aliexpress-readiness-golden-proof');

const SKU_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';
const UNIT_REF = '12000052119244345';
const SOLD_IDENTITY = {
  provider: 'aliexpress',
  version: 1,
  payload: { sku_id: UNIT_REF, sku_attr: '14:Beige;200001036:1m' },
};

function env() {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://test',
    KOMERCE_ALLOW_ALIEXPRESS_READINESS_PROOF: '1',
  };
}

function query() {
  return jest.fn(async () => ({
    rows: [{
      id: SKU_ID,
      product_id: PRODUCT_ID,
      supplier_sku: '14:771#1pcs;200001036:200746126',
      supplier_unit_ref: UNIT_REF,
      supplier_order_identity: SOLD_IDENTITY,
    }],
  }));
}

function readyVerdict(overrides = {}) {
  return {
    status: 'FULFILLMENT_READY',
    ready: true,
    provider: 'aliexpress',
    canonical_unit_id: '33333333-3333-4333-8333-333333333333',
    supplier_unit_ref: UNIT_REF,
    identity: SOLD_IDENTITY,
    money: { unit_price: 3.19, currency: 'USD' },
    place_order_invoked: false,
    preflight: {
      ready: true,
      evidence: {
        provider: 'aliexpress',
        supplier_unit_ref: UNIT_REF,
        stock_available: 205,
        unit_price: 3.19,
        currency: 'USD',
        supplier_origin_country_code: 'CN',
        destination_country_code: 'AE',
        exact_unit_resolved: true,
        live_stock_checked: true,
        live_price_checked: true,
        supplier_leg_checked: true,
        freight: { success: true, has_options: true, error: null },
        place_order_invoked: false,
        payment_invoked: false,
      },
    },
    ...overrides,
  };
}

test('A2 — exact SKU → canonical gate → live stock/price/freight, sans mutation fournisseur', async () => {
  const q = query();
  const readiness = jest.fn().mockResolvedValue(readyVerdict());

  const report = await proof.run([SKU_ID], {
    env: env(),
    query: q,
    readiness,
    adapters: { aliexpress: { provider: 'aliexpress' } },
  });

  expect(readiness).toHaveBeenCalledWith(expect.objectContaining({
    productSkuId: SKU_ID,
    quantity: 1,
    soldIdentity: SOLD_IDENTITY,
  }));
  expect(report).toMatchObject({
    status: 'PASS',
    proof: 'GOLDEN_E2E_A2_ALIEXPRESS_READINESS',
    product_sku_id: SKU_ID,
    product_id: PRODUCT_ID,
    supplier_unit_ref: UNIT_REF,
    provider: 'aliexpress',
    canonical_money: { unit_price: 3.19, currency: 'USD' },
    live: {
      stock_available: 205,
      unit_price: 3.19,
      currency: 'USD',
      supplier_origin_country_code: 'CN',
      destination_country_code: 'AE',
      freight: { success: true, has_options: true },
    },
    mutation: {
      place_order_invoked: false,
      payment_invoked: false,
    },
  });
});

test.each([
  ['verdict non ready', readyVerdict({ ready: false, status: 'OUT_OF_STOCK', reason: 'stock' }), 'ALIEXPRESS_READINESS_NOT_READY'],
  ['preflight absent', readyVerdict({ preflight: null }), 'ALIEXPRESS_READINESS_REMOTE_PREFLIGHT_MISSING'],
  ['unité non prouvée', readyVerdict({ preflight: { ready: true, evidence: { ...readyVerdict().preflight.evidence, exact_unit_resolved: false } } }), 'ALIEXPRESS_READINESS_EXACT_UNIT_NOT_PROVEN'],
  ['stock invalide', readyVerdict({ preflight: { ready: true, evidence: { ...readyVerdict().preflight.evidence, stock_available: 0 } } }), 'ALIEXPRESS_READINESS_LIVE_STOCK_INVALID'],
  ['prix invalide', readyVerdict({ preflight: { ready: true, evidence: { ...readyVerdict().preflight.evidence, unit_price: 0 } } }), 'ALIEXPRESS_READINESS_LIVE_PRICE_INVALID'],
  ['fret absent', readyVerdict({ preflight: { ready: true, evidence: { ...readyVerdict().preflight.evidence, freight: { success: true, has_options: false } } } }), 'ALIEXPRESS_READINESS_FREIGHT_NOT_PROVEN'],
  ['placeOrder invoqué', readyVerdict({ place_order_invoked: true }), 'ALIEXPRESS_READINESS_PLACE_ORDER_MUST_BE_FALSE'],
  ['payment invoqué', readyVerdict({ preflight: { ready: true, evidence: { ...readyVerdict().preflight.evidence, payment_invoked: true } } }), 'ALIEXPRESS_READINESS_PAYMENT_MUST_BE_FALSE'],
  ['mauvaise unité', readyVerdict({ supplier_unit_ref: '999' }), 'ALIEXPRESS_READINESS_UNIT_REF_MISMATCH'],
])('fail-closed — %s', async (_label, verdict, code) => {
  await expect(proof.run([SKU_ID], {
    env: env(),
    query: query(),
    readiness: jest.fn().mockResolvedValue(verdict),
    adapters: {},
  })).rejects.toThrow(code);
});

test('refuse production, flag absent, mauvais SKU et provider différent', async () => {
  expect(() => proof.guard({ NODE_ENV: 'production', DATABASE_URL: 'x', KOMERCE_ALLOW_ALIEXPRESS_READINESS_PROOF: '1' }))
    .toThrow('interdit en production');
  expect(() => proof.guard({ NODE_ENV: 'test', DATABASE_URL: 'x' }))
    .toThrow('KOMERCE_ALLOW_ALIEXPRESS_READINESS_PROOF=1 requis');
  expect(() => proof.requireUuid('bad')).toThrow('PRODUCT_SKU_ID_INVALID');

  const q = jest.fn().mockResolvedValue({
    rows: [{
      id: SKU_ID,
      product_id: PRODUCT_ID,
      supplier_sku: 'X',
      supplier_unit_ref: UNIT_REF,
      supplier_order_identity: { provider: 'cj', version: 1, payload: { vid: 'x' } },
    }],
  });
  await expect(proof.loadSoldSku(q, SKU_ID)).rejects.toThrow('ALIEXPRESS_READINESS_PROVIDER_MISMATCH');
});
