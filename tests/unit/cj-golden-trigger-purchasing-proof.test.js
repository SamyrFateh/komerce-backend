'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({
  query: jest.fn(),
  pool: { end: jest.fn() },
}));
jest.mock('../../services/suppliers/connectors/cj-connector', () => ({
  fetchProducts: jest.fn(),
}));
jest.mock('../../services/purchasing-trigger-service', () => ({
  triggerPurchasing: jest.fn(),
}));

const proof = require('../../scripts/cj-golden-trigger-purchasing-proof');

function safeEnv(extra = {}) {
  return {
    DATABASE_URL: 'postgres://ephemeral',
    NODE_ENV: 'test',
    KOMERCE_ENV: 'staging',
    KOMERCE_ALLOW_CJ_GOLDEN_TRIGGER: '1',
    KOMERCE_CJ_SANDBOX: '1',
    KOMERCE_CJ_AUTO_ORDER_ENABLED: '1',
    ...extra,
  };
}

test('Golden CJ refuse catégoriquement production', () => {
  expect(() => proof.guard(safeEnv({ KOMERCE_ENV: 'production' })))
    .toThrow('CJ Golden interdit en production');
});

test('Golden CJ exige une autorisation dédiée', () => {
  const env = safeEnv();
  delete env.KOMERCE_ALLOW_CJ_GOLDEN_TRIGGER;
  expect(() => proof.guard(env))
    .toThrow('KOMERCE_ALLOW_CJ_GOLDEN_TRIGGER=1 requis');
});

test('Golden CJ exige sandbox explicite', () => {
  const env = safeEnv({ KOMERCE_CJ_SANDBOX: '0' });
  expect(() => proof.guard(env))
    .toThrow('KOMERCE_CJ_SANDBOX=1 requis');
});

test('Golden CJ exige le cutover auto-order explicite', () => {
  const env = safeEnv({ KOMERCE_CJ_AUTO_ORDER_ENABLED: '0' });
  expect(() => proof.guard(env))
    .toThrow('KOMERCE_CJ_AUTO_ORDER_ENABLED=1 requis');
});

test('Golden CJ autorise uniquement un runtime test/staging complet', () => {
  expect(proof.guard(safeEnv())).toBeUndefined();
});
