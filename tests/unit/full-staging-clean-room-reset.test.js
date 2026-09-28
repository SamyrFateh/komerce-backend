'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

describe('staging clean-room reset guards and scope', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('scope clears catalogue+sourcing operational data but preserves configuration tables', () => {
    process.env.KOMERCE_ENV = 'staging';
    process.env.NODE_ENV = 'test';
    process.env.KOMERCE_ALLOW_FULL_CATALOG_RESET = '1';
    process.env.DATABASE_URL = 'postgres://example.invalid/test';

    jest.doMock('../../db', () => ({ getClient: jest.fn(), pool: { end: jest.fn() } }));
    const reset = require('../../scripts/full-staging-catalog-reset');

    expect(reset.ROOT_TABLES).toEqual(expect.arrayContaining([
      'orders',
      'products',
      'supplier_catalog_imports',
      'import_runtime_runs',
      'sourcing_captures',
      'sourcing_commercial_principals',
    ]));
    expect(reset.ZERO_TABLES).toEqual(expect.arrayContaining([
      'sourcing_candidates',
      'sourcing_observations',
      'sourcing_resolution_decisions',
      'sourcing_canonical_entities',
      'import_runtime_runs',
    ]));
    expect(reset.PRESERVE_TABLES).toEqual(expect.arrayContaining([
      'sourcing_sources',
      'sourcing_merge_policies',
      'sourcing_global_access_grants',
    ]));
    expect(reset.RESET_SEQUENCES).toEqual(expect.arrayContaining([
      'product_ref_seq',
      'catalog_import_ref_seq',
      'sourcing_candidate_ref_seq',
      'import_runtime_run_ref_seq',
    ]));
  });

  test('refuses anything except explicit staging', () => {
    process.env.KOMERCE_ENV = 'production';
    process.env.NODE_ENV = 'test';
    process.env.KOMERCE_ALLOW_FULL_CATALOG_RESET = '1';
    process.env.DATABASE_URL = 'postgres://example.invalid/test';

    jest.doMock('../../db', () => ({ getClient: jest.fn(), pool: { end: jest.fn() } }));
    const { assertStaging } = require('../../scripts/full-staging-catalog-reset');
    expect(assertStaging).toThrow(/KOMERCE_ENV=staging/);
  });

  test('refuses production NODE_ENV even if KOMERCE_ENV says staging', () => {
    process.env.KOMERCE_ENV = 'staging';
    process.env.NODE_ENV = 'production';
    process.env.KOMERCE_ALLOW_FULL_CATALOG_RESET = '1';
    process.env.DATABASE_URL = 'postgres://example.invalid/test';

    jest.doMock('../../db', () => ({ getClient: jest.fn(), pool: { end: jest.fn() } }));
    const { assertStaging } = require('../../scripts/full-staging-catalog-reset');
    expect(assertStaging).toThrow(/NODE_ENV=production/);
  });
});
