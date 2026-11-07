/**
 * @komerce-arch-lite
 * @role hub-v1-clicks-config
 * @domain dashboard
 * @layer test-config
 * @owner backend-core
 * @purpose Chromium reel (clics) sur staging KM sur fixture E2E ; local uniquement avec E2E_CLICKS_ALLOW_LOCAL=1 (repetition).
 * @impact-areas dashboard, hub, relay, staging-only
 */
'use strict';
const { defineConfig } = require('@playwright/test');
const STAGING = 'https://komerce-backend-production.up.railway.app';
const baseURL = process.env.E2E_CLICKS_BASE_URL || STAGING;
const origin = new URL(baseURL).origin;
if (origin !== STAGING && !(process.env.E2E_CLICKS_ALLOW_LOCAL === '1' && /^http:\/\/localhost:\d+$/.test(origin))) throw new Error('Staging host only');
module.exports = defineConfig({
  testDir: './tests/staging-clicks', testMatch: '*.spec.js',
  outputDir: 'test-results/hub-v1-clicks/raw',
  timeout: 1200000, retries: 0, workers: 1, fullyParallel: false,
  reporter: [['line'], ['json', { outputFile: 'test-results/hub-v1-clicks/playwright.json' }]],
  use: { baseURL, browserName: 'chromium', headless: true, video: 'off', trace: 'off', screenshot: 'off', viewport: { width: 1440, height: 900 }, actionTimeout: 15000, navigationTimeout: 30000 },
});
