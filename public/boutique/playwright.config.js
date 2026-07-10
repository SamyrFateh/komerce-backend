// playwright.config.js
// @brief Configuration Playwright — Boutique Komerce (ARCH-7)
// @version D7 — ajout webServer (résout ERR_CONNECTION_REFUSED en local et CI)

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: ['**/e2e/**/*.spec.js', '**/contracts.spec.js'],

  // Timeout global par test (30s — les flows avec offline peuvent être lents)
  timeout: 30_000,

  // Relance automatique en cas d'échec flaky (CI uniquement)
  retries: process.env.CI ? 2 : 0,

  // Rapport lisible en local, JUnit en CI
  reporter: process.env.CI
    ? [['junit', { outputFile: 'test-results/results.xml' }], ['list']]
    : [['html', { open: 'never' }], ['list']],

  // ── Serveur de développement intégré ──────────────────────────────────────
  // Lance `npx serve . -p 3000` avant les tests et l'arrête après.
  // En CI, réutilise un serveur déjà démarré si PORT 3000 est occupé.
  // Pour pointer vers staging : BASE_URL=https://staging.example.com npx playwright test
  // (webServer est ignoré si BASE_URL est défini sur une URL distante — voir condition ci-dessous)
  ...(
    !process.env.BASE_URL || process.env.BASE_URL.startsWith('http://localhost')
      ? {
          webServer: {
            command: 'npx serve . --listen 3000 --no-clipboard',
            url: 'http://localhost:3000',
            reuseExistingServer: !process.env.CI,
            timeout: 15_000,
            stdout: 'ignore',
            stderr: 'pipe',
          },
        }
      : {}
  ),

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
    // ── Desktop ────────────────────────────────────────────────────────────
    {
      name: 'Desktop Chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        locale: 'fr-FR',
      },
    },
    {
      name: 'Desktop Firefox',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1280, height: 800 },
        locale: 'fr-FR',
      },
    },
    {
      name: 'Desktop Safari',
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1280, height: 800 },
        locale: 'fr-FR',
      },
    },

    // ── Mobile (la boutique est mobile-first — diaspora comorienne) ─────────
    {
      name: 'Mobile Chrome',
      use: {
        ...devices['Pixel 7'],
        locale: 'fr-FR',
      },
    },
    {
      name: 'Mobile Safari',
      use: {
        ...devices['iPhone 14'],
        locale: 'fr-FR',
      },
    },
  ],

  // Dossier de sortie des rapports et screenshots
  outputDir: 'test-results/',
});
