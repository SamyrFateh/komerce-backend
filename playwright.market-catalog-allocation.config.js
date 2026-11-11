'use strict';
/* @test-kind e2e @test-runner playwright @test-requires none
 * N1/N2 allocation audit in the country catalogue — isolated, no staging writes.
 */
const {defineConfig} = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: 'market-catalog-pricing-list.spec.js',
  fullyParallel: false,
  timeout: 45000,
  expect: {timeout: 10000},
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    headless: true,
    viewport: {width: 1440, height: 900},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  outputDir: 'test-results/market-catalog-allocation',
});
