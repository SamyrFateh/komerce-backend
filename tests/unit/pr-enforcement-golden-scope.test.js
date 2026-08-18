'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  isGoldenCdrFile,
  classify,
} = require('../../scripts/pr-enforcement-scope');

describe('PR enforcement — Golden CDR scope', () => {
  test.each([
    '.github/workflows/golden-cdr.yml',
    'services/pricing-cdr.js',
    'services/pricing-engine.js',
    'services/pricing-recommend.js',
    'services/transport-pricing.js',
    'services/transport-rails.js',
    'routes/admin-pricing-matrices.js',
    'routes/admin-finance-config.js',
    'routes/economic.js',
    'services/economic-engine-queries.js',
    'services/dashboard-ops-queries.js',
    'services/cost-allocation/allocate.js',
    'utils/eco-bridge.js',
    'utils/rates.js',
    'utils/relay-commission.js',
    'tools/golden-cdr/golden-cdr.js',
    'tools/golden-cdr/witnesses.js',
    'tools/golden-cdr/fixtures/config.demo.json',
    'tools/golden-cdr/golden/cdr.golden.json',
  ])('%s déclenche la parité Golden', file => {
    expect(isGoldenCdrFile(file)).toBe(true);
    const result = classify([file]);
    expect(result.golden).toBe(true);
    expect(result.goldenFiles).toEqual([file]);
  });

  test.each([
    'services/orders.js',
    'public/boutique/js/b-cart.js',
    'migrations/119_example.sql',
    'docs/README.md',
  ])('%s ne déclenche pas Golden', file => {
    expect(isGoldenCdrFile(file)).toBe(false);
    expect(classify([file]).golden).toBe(false);
  });

  test('un fichier du harnais Golden seul ne prétend pas être backend', () => {
    const result = classify(['tools/golden-cdr/witnesses.js']);
    expect(result.golden).toBe(true);
    expect(result.backend).toBe(false);
  });
});
