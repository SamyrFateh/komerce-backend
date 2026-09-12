'use strict';

const {
  modeFromArgv,
  runtimeEnvironment,
  assertRuntime,
  cleanStockSql,
  EXPECTED_ALIEXPRESS_CLEAN,
} = require('../../scripts/staging-catalog-prune');

describe('staging-catalog-prune contract', () => {
  test('defaults to dry-run and requires explicit execute', () => {
    expect(modeFromArgv([])).toBe('dry-run');
    expect(modeFromArgv(['--dry-run'])).toBe('dry-run');
    expect(modeFromArgv(['--execute'])).toBe('execute');
    expect(() => modeFromArgv(['--dry-run', '--execute'])).toThrow(/pas les deux/i);
  });

  test('KOMERCE_ENV is the runtime authority', () => {
    expect(runtimeEnvironment({ KOMERCE_ENV: 'staging', NODE_ENV: 'production' })).toBe('staging');
    expect(runtimeEnvironment({ KOMERCE_ENV: ' production ', NODE_ENV: 'test' })).toBe('production');
  });

  test('refuses anything except explicit staging with DATABASE_URL', () => {
    expect(() => assertRuntime('dry-run', {
      KOMERCE_ENV: 'production',
      DATABASE_URL: 'postgres://example',
    })).toThrow(/staging requis/i);

    expect(() => assertRuntime('execute', {
      KOMERCE_ENV: 'staging',
    })).toThrow(/DATABASE_URL requis/i);

    expect(() => assertRuntime('dry-run', {
      KOMERCE_ENV: 'staging',
      DATABASE_URL: 'postgres://example',
    })).not.toThrow();
  });

  test('AliExpress invariant is frozen at 500 clean candidates', () => {
    expect(EXPECTED_ALIEXPRESS_CLEAN).toBe(500);
    expect(cleanStockSql('sc')).toContain("normalized_source_contract ? 'stock_available'");
    expect(() => cleanStockSql('sc; DROP TABLE products')).toThrow(/Alias SQL invalide/);
  });
});
