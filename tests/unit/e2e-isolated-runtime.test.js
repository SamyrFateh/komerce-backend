'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const guard = require('../../services/suppliers/e2e-isolated-runtime');

describe('isolated E2E runtime guard', () => {
  test('accepts the historical disposable localhost database', () => {
    expect(guard.assertIsolatedE2eRuntime({
      KOMERCE_ENV: 'staging',
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://komerce:komerce@127.0.0.1:5432/komerce_real_catalog_stress',
    })).toMatchObject({ mode: 'local-disposable' });
  });

  test('accepts Railway only with the explicit canonical 700 dataset contract', () => {
    expect(guard.assertIsolatedE2eRuntime({
      KOMERCE_ENV: 'staging',
      NODE_ENV: 'test',
      KOMERCE_DISABLE_CRONS: 'true',
      KOMERCE_ALLOW_RAILWAY_ISOLATED_E2E: '1',
      KOMERCE_E2E_DATASET_ID: 'catalog-e2e-700-v1',
      DATABASE_URL: 'postgresql://u:p@catalog700.railway.internal:5432/railway',
    })).toMatchObject({
      mode: 'railway-isolated',
      dataset_id: 'catalog-e2e-700-v1',
    });
  });

  test('rejects a Railway database when any isolation proof is absent', () => {
    const base = {
      KOMERCE_ENV: 'staging',
      NODE_ENV: 'test',
      KOMERCE_DISABLE_CRONS: 'true',
      KOMERCE_ALLOW_RAILWAY_ISOLATED_E2E: '1',
      KOMERCE_E2E_DATASET_ID: 'catalog-e2e-700-v1',
      DATABASE_URL: 'postgresql://u:p@catalog700.railway.internal:5432/railway',
    };
    for (const key of [
      'KOMERCE_DISABLE_CRONS',
      'KOMERCE_ALLOW_RAILWAY_ISOLATED_E2E',
      'KOMERCE_E2E_DATASET_ID',
    ]) {
      const env = { ...base };
      delete env[key];
      expect(() => guard.assertIsolatedE2eRuntime(env)).toThrow(/base E2E isolée/);
    }
  });

  test('rejects production and non-isolated hosts', () => {
    expect(() => guard.assertIsolatedE2eRuntime({
      KOMERCE_ENV: 'production',
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://u:p@catalog700.railway.internal:5432/railway',
    })).toThrow(/staging/);

    expect(() => guard.assertIsolatedE2eRuntime({
      KOMERCE_ENV: 'staging',
      NODE_ENV: 'test',
      KOMERCE_DISABLE_CRONS: 'true',
      KOMERCE_ALLOW_RAILWAY_ISOLATED_E2E: '1',
      KOMERCE_E2E_DATASET_ID: 'catalog-e2e-700-v1',
      DATABASE_URL: 'postgresql://u:p@prod.example.com:5432/production',
    })).toThrow(/base E2E isolée/);
  });
});
