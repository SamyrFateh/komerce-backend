'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { requireNonProduction, resolveRuntimeEnvironment } = require('../../middleware/require-non-production');

const ORIGINAL_ENV = { ...process.env };

function invoke(mw) {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const next = jest.fn();
  mw({}, res, next);
  return { res, next };
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.KOMERCE_ENV;
  delete process.env.NODE_ENV;
  delete process.env.ALLOW_FLUSH;
});

afterAll(() => { process.env = ORIGINAL_ENV; });

test('KOMERCE_ENV est prioritaire sur NODE_ENV', () => {
  process.env.KOMERCE_ENV = 'staging';
  process.env.NODE_ENV = 'production';
  expect(resolveRuntimeEnvironment()).toEqual({ env: 'staging', source: 'KOMERCE_ENV' });
  const { next } = invoke(requireNonProduction());
  expect(next).toHaveBeenCalledTimes(1);
});

test('bloque quand KOMERCE_ENV=production même si NODE_ENV=development', () => {
  process.env.KOMERCE_ENV = 'production';
  process.env.NODE_ENV = 'development';
  const { res, next } = invoke(requireNonProduction());
  expect(res.statusCode).toBe(403);
  expect(res.body.error).toMatch(/désactivé en production/);
  expect(res.body.environment_source).toBe('KOMERCE_ENV');
  expect(next).not.toHaveBeenCalled();
});

test('retombe sur NODE_ENV quand KOMERCE_ENV est absent', () => {
  process.env.NODE_ENV = 'production';
  const { res, next } = invoke(requireNonProduction());
  expect(res.statusCode).toBe(403);
  expect(res.body.environment_source).toBe('NODE_ENV');
  expect(next).not.toHaveBeenCalled();
});

test('bypass explicite uniquement pour la variable demandée', () => {
  process.env.KOMERCE_ENV = 'production';
  process.env.ALLOW_FLUSH = 'true';
  const { next } = invoke(requireNonProduction('ALLOW_FLUSH'));
  expect(next).toHaveBeenCalledTimes(1);
});
