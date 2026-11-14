'use strict';

const { defineConfig, devices } = require('@playwright/test');
const remote = process.env.BASE_URL || null;
const baseURL = remote || 'http://127.0.0.1:3000/boutique/';

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: 'pdp-sidecart-geometry.spec.js',
  timeout: 45000,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/pdp-sidecart-geometry/results.json' }]],
  outputDir: '.playwright-pdp-geometry',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    viewport: { width: 1440, height: 900 },
    locale: 'fr-FR',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  ...(!remote ? {
    webServer: {
      command: 'npx serve .. --listen 3000 --no-clipboard',
      url: 'http://127.0.0.1:3000/boutique/',
      reuseExistingServer: false,
      timeout: 30000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  } : {}),
});
