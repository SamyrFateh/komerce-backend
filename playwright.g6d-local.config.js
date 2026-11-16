/**
 * G6-D: real Chromium against an isolated localhost server and disposable PG16 only; never Railway.
 */
'use strict';
const { defineConfig } = require('@playwright/test');
const { assertEphemeralTarget } = require('./scripts/recette/hub-v1-certification-runner');
const LOCAL = 'http://localhost:3917';
assertEphemeralTarget(process.env.DATABASE_URL, []);
if (process.env.G6D_LOCAL !== '1' || process.env.E2E_CLICKS_BASE_URL !== LOCAL ||
    process.env.NODE_ENV !== 'test' || process.env.STAGING_BASE_URL || process.env.E2E_STAGING_BASE_URL ||
    !/^[a-f0-9]{40}$/i.test(String(process.env.E2E_EXPECTED_DEPLOY_SHA || ''))) {
  throw new Error('G6D_LOCAL_CHROMIUM_DISPOSABLE_TARGET_ONLY');
}
module.exports = defineConfig({
  testDir: 'tests/local-chromium',
  testMatch: 'g6d-refund-cash-deposit.spec.js',
  outputDir: 'test-results/g6d/raw',
  timeout: 180000, retries: 0, workers: 1, fullyParallel: false,
  reporter: [['line'], ['json', { outputFile: 'test-results/g6d/playwright.json' }]],
  use: { baseURL: LOCAL, browserName: 'chromium', headless: true, video: 'off', trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 }, actionTimeout: 15000, navigationTimeout: 30000 },
});
