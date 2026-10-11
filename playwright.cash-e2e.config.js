/**
 * @komerce-arch
 * @role          playwright-cash-multiuser-e2e-config
 * @domain        payments
 * @layer         test-config
 * @criticality   medium
 * @inputs        tests/e2e-cash (service réel, vrai login, base de test), E2E_BASE_URL, E2E_ADMIN_PASSWORD, DATABASE_URL
 * @outputs       cash_multiuser_recette_report
 * @depends       @playwright/test
 * @used-by       npm run test:e2e:cash
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      real_auth_no_forged_jwt, no_simulated_api, target_must_be_confirmed
 * @impact-areas  payments, dashboard
 * @version       2026-10
 */

'use strict';

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e-cash',
  testMatch: ['*.spec.js'],
  outputDir: './.playwright-output/cash',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60000,
  expect: { timeout: 8000 },
  use: {
    browserName: 'chromium',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : undefined,
  },
});
