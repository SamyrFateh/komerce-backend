/**
 * @komerce-arch-lite
 * @role g6e-local-chromium-config
 * @domain dashboard
 * @layer test-config
 * @owner backend-core
 * @purpose Chromium local (PG jetable, jamais staging) pour les gestes G6-E : invendus et Relais.
 * @impact-areas dashboard, unsold, relay
 */
'use strict';
const { defineConfig } = require('@playwright/test');
const LOCAL = 'http://localhost:3917';
if (process.env.G6E_LOCAL !== '1' || process.env.KOMERCE_ENV !== 'test' || process.env.E2E_BASE_URL !== LOCAL ||
    !/_test$/i.test(String(process.env.DATABASE_URL || '').split('/').pop()) ||
    !/localhost|127\.0\.0\.1/.test(String(process.env.DATABASE_URL || ''))) {
  throw new Error('G6E_LOCAL_DISPOSABLE_TARGET_ONLY');
}
module.exports = defineConfig({
  testDir: './tests/local-chromium', testMatch: 'g6e-*.spec.js',
  outputDir: 'test-results/g6e-local',
  timeout: 120000, retries: 0, workers: 1, fullyParallel: false,
  reporter: [['line']],
  use: { baseURL: LOCAL, browserName: 'chromium', headless: true, launchOptions: process.env.G6E_CHROME ? { executablePath: process.env.G6E_CHROME } : {}, viewport: { width: 1440, height: 900 }, actionTimeout: 15000 },
});
