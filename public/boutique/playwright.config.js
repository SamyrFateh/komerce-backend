// playwright.config.js
// @brief Configuration Playwright — Boutique Komerce (ARCH-7)

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',

  // Timeout global par test (30s — les flows avec offline peuvent être lents)
  timeout: 30_000,

  // Relance automatique en cas d'échec flaky (CI uniquement)
  retries: process.env.CI ? 2 : 0,

  // Rapport lisible en local, JUnit en CI
  reporter: process.env.CI
    ? [['junit', { outputFile: 'test-results/results.xml' }], ['list']]
    : [['html', { open: 'never' }], ['list']],

  use: {
    // URL de base — surcharger via BASE_URL=https://staging.railway.app
    baseURL: process.env.BASE_URL || 'http://localhost:3000',

    // Screenshot uniquement en cas d'échec
    screenshot: 'only-on-failure',

    // Trace en cas d'échec (utile pour debug CI)
    trace: 'on-first-retry',

    // Viewport mobile-first (la boutique est mobile-first)
    viewport: { width: 390, height: 844 },

    // Locale FR pour correspondre aux formats prix/date affichés
    locale: 'fr-FR',
  },

  projects: [
    {
      name: 'Mobile Chrome',
      use: {
        ...devices['Pixel 7'],
        locale: 'fr-FR',
      },
    },
    {
      name: 'Desktop Chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        locale: 'fr-FR',
      },
    },
  ],

  // Dossier de sortie des rapports et screenshots
  outputDir: 'test-results/',
});
