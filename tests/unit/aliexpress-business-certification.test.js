'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../db', () => ({ query: jest.fn(), pool: { end: jest.fn() } }));

const cert = require('../../scripts/aliexpress-business-certification');

const SKU_ID = '11111111-1111-4111-8111-111111111111';

function baseEnv() {
  return {
    NODE_ENV: 'test',
    KOMERCE_ENV: 'staging',
    DATABASE_URL: 'postgres://test',
    KOMERCE_ALLOW_ALIEXPRESS_BUSINESS_CERTIFICATION: '1',
  };
}

function candidateQuery(rows = [{ id: SKU_ID, product_ref: 'KPR-ALI-1' }]) {
  return jest.fn(async () => ({ rows }));
}

test('defaults to readiness and rejects unsupported modes', () => {
  expect(cert.parseMode([])).toBe('readiness');
  expect(cert.parseMode(['--mode=order'])).toBe('order');
  expect(() => cert.parseMode(['--mode=unknown'])).toThrow('ALIEXPRESS_BUSINESS_CERTIFICATION_MODE_INVALID');
});

test('fail-closed in production and requires explicit order opt-in', () => {
  expect(() => cert.guard({
    ...baseEnv(),
    KOMERCE_ENV: 'production',
  }, 'readiness')).toThrow('interdite en production');

  expect(() => cert.guard({
    ...baseEnv(),
    KOMERCE_ALLOW_ALIEXPRESS_BUSINESS_CERTIFICATION: '0',
  }, 'readiness')).toThrow('KOMERCE_ALLOW_ALIEXPRESS_BUSINESS_CERTIFICATION=1 requis');

  expect(() => cert.guard(baseEnv(), 'order')).toThrow('KOMERCE_ALLOW_ALIEXPRESS_ORDER_PROOF=1 requis');
});

test('readiness mode auto-selects an exact active AliExpress SKU and never mutates provider', async () => {
  const readinessRun = jest.fn(async () => ({
    status: 'PASS',
    provider: 'aliexpress',
    supplier_unit_ref: 'ALI-UNIT-1',
    live: {
      stock_available: 7,
      unit_price: 4.25,
      currency: 'USD',
      freight: { success: true, has_options: true, service_name: 'CAINIAO_STD' },
    },
  }));

  const report = await cert.run([], {
    env: baseEnv(),
    query: candidateQuery(),
    readinessRun,
    orderRun: jest.fn(),
  });

  expect(readinessRun).toHaveBeenCalledWith([SKU_ID], expect.objectContaining({
    env: expect.objectContaining({ KOMERCE_ALLOW_ALIEXPRESS_READINESS_PROOF: '1' }),
  }));
  expect(report).toMatchObject({
    status: 'PASS',
    mode: 'readiness',
    product_ref: 'KPR-ALI-1',
    readiness: {
      supplier_unit_ref: 'ALI-UNIT-1',
      stock_available: 7,
      unit_price: 4.25,
      currency: 'USD',
    },
    mutation: { place_order_invoked: false, payment_invoked: false },
  });
});

test('order mode executes exactly the existing unpaid create/read-back proof', async () => {
  const env = {
    ...baseEnv(),
    KOMERCE_ALLOW_ALIEXPRESS_ORDER_PROOF: '1',
  };
  const readinessRun = jest.fn(async () => ({
    status: 'PASS',
    provider: 'aliexpress',
    supplier_unit_ref: 'ALI-UNIT-1',
    live: { stock_available: 4, unit_price: 3.19, currency: 'USD', freight: { has_options: true } },
  }));
  const orderRun = jest.fn(async () => ({
    supplier_order_id: '123456789',
    commitment_verdict: 'created_unpaid',
    readback_status: 'PLACE_ORDER_SUCCESS',
    execution_recovery: 'CREATED_NOW_NO_NATIVE_IDEMPOTENCY',
  }));

  const report = await cert.run(['--mode=order'], {
    env,
    query: candidateQuery(),
    readinessRun,
    orderRun,
  });

  expect(readinessRun).toHaveBeenCalledTimes(1);
  expect(orderRun).toHaveBeenCalledTimes(1);
  expect(orderRun).toHaveBeenCalledWith([SKU_ID], expect.objectContaining({
    env: expect.objectContaining({ KOMERCE_ALLOW_ALIEXPRESS_READINESS_PROOF: '1' }),
  }));
  expect(report).toMatchObject({
    status: 'PASS',
    mode: 'order',
    supplier_order_id: '123456789',
    commitment_verdict: 'created_unpaid',
    mutation: { place_order_invoked: true, payment_invoked: false },
  });
});

test('tries the next candidate when a live SKU fails readiness', async () => {
  const query = candidateQuery([
    { id: SKU_ID, product_ref: 'KPR-ALI-1' },
    { id: '22222222-2222-4222-8222-222222222222', product_ref: 'KPR-ALI-2' },
  ]);
  const readinessRun = jest.fn()
    .mockRejectedValueOnce(new Error('OUT_OF_STOCK'))
    .mockResolvedValueOnce({
      status: 'PASS',
      provider: 'aliexpress',
      supplier_unit_ref: 'ALI-UNIT-2',
      live: { stock_available: 2, unit_price: 5, currency: 'USD', freight: { has_options: true } },
    });

  const report = await cert.run([], {
    env: baseEnv(),
    query,
    readinessRun,
    orderRun: jest.fn(),
  });

  expect(readinessRun).toHaveBeenCalledTimes(2);
  expect(report.product_ref).toBe('KPR-ALI-2');
});

test('fails closed when staging has no active AliExpress SKU', async () => {
  await expect(cert.run([], {
    env: baseEnv(),
    query: candidateQuery([]),
    readinessRun: jest.fn(),
    orderRun: jest.fn(),
  })).rejects.toThrow('ALIEXPRESS_BUSINESS_CERTIFICATION_NO_ACTIVE_SKU');
});
