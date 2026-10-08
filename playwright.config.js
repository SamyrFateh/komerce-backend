/**
 * @komerce-arch
 * @role          playwright-dashboard-e2e-config
 * @domain        dashboard
 * @layer         test-config
 * @criticality   medium
 * @inputs        tests/e2e dashboard specs (API simulée), PLAYWRIGHT_CHROMIUM_EXECUTABLE optionnel
 * @outputs       dashboard_e2e_gate
 * @depends       @playwright/test
 * @used-by       npm run test:e2e:dashboards, .github/workflows/pr-enforcement.yml
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      deterministic_no_retry, simulated_api_no_server_no_db, chromium_only_official_gate, no_screenshot_baseline_before_theme_consolidation
 * @impact-areas  dashboard
 * @version       2026-10
 */

'use strict';

const { defineConfig } = require('@playwright/test');

// Gate officiel : specs du dashboard canonique, API simulée (aucun serveur, aucune base).
// Les specs boutique historiques de tests/e2e (dépendent d'un helper absent) n'en font pas partie.
const DASHBOARD_SPECS = [
  'live-ops-shell',
  'hub-live-cockpit',
  'relais-live-cockpit',
  'import-runtime-cockpit',
  'import-runtime-credentials',
  'import-runtime-source-registry',
  'purchasing-workspace',
  'dashboard-role-matrix',
  'order-360-lineage',
  'b9-ui-truth-paths',
];

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: DASHBOARD_SPECS.map(name => `${name}.spec.js`),
  outputDir: './.playwright-output',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  // Aucun retry : un test instable est un défaut à corriger, pas à masquer.
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list']] : [['list']],
  timeout: 30000,
  expect: { timeout: 5000 },
  use: {
    browserName: 'chromium',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
});
