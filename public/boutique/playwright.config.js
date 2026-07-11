// playwright.config.js
// @brief Configuration Playwright — Boutique Komerce (ARCH-7)
// @version D7 — ajout webServer (résout ERR_CONNECTION_REFUSED en local et CI)

const { defineConfig, devices } = require('@playwright/test');

// ── Mode remote vs local ──────────────────────────────────────────────────
// Le simple fait de fournir BASE_URL bascule en mode DISTANT (tests fonctionnels
// réels contre un environnement qui expose catalogue/API — ex. https://komerce.co/boutique/).
// Sans BASE_URL, mode LOCAL : `npx serve ..` sert des fichiers statiques
// (public/), SANS aucune API backend — utile pour le rendu/CSS, pas pour les
// flows catalogue/checkout/wallet/tracking/groupe qui dépendent du backend réel.
const remoteBaseURL = process.env.BASE_URL;
const isRemote = Boolean(remoteBaseURL);
const baseURL = remoteBaseURL || 'http://localhost:3000/boutique/';

// eslint-disable-next-line no-console
console.log(
  `[playwright.config] mode=${isRemote ? 'DISTANT' : 'LOCAL (statique, sans backend)'} baseURL=${baseURL}`
);

module.exports = defineConfig({
  testDir: './tests',
  testMatch: ['**/e2e/**/*.spec.js', '**/contracts.spec.js'],

  // Timeout global par test (30s en LOCAL). En DISTANT, certains specs
  // enchaînent plusieurs cycles de timeout API (ex. E15 : wallet → track →
  // group, ~10s chacun via K.request DEFAULT_TIMEOUT_MS) + latence réseau
  // réelle vers komerce.co — 30s est trop juste et casse au 2e/3e cycle
  // sans qu'il y ait de bug fonctionnel. 45s en DISTANT laisse la marge
  // que le mécanisme de timeout (qui fonctionne correctement) a besoin
  // pour s'exécuter jusqu'au bout sur les 3 onglets séquentiels.
  timeout: isRemote ? 45_000 : 30_000,

  // Relance automatique en cas d'échec flaky (CI uniquement)
  retries: process.env.CI ? 2 : 0,

  // Rapport lisible en local, JUnit en CI
  reporter: process.env.CI
    ? [['junit', { outputFile: 'test-results/results.xml' }], ['list']]
    : [['html', { open: 'never' }], ['list']],

  // ── Serveur de développement intégré (mode LOCAL uniquement) ──────────────
  // Lance `npx serve ..` (racine = public/, car index.html référence des
  // chemins absolus /boutique/css/..., /images/...) avant les tests et
  // l'arrête après. Jamais lancé en mode DISTANT (BASE_URL fourni) : dans ce
  // cas Playwright ne fait QUE naviguer vers baseURL, aucun serveur local.
  ...(!isRemote
    ? {
        webServer: {
          command: 'npx serve .. --listen 3000 --no-clipboard',
          url: 'http://localhost:3000/boutique/',
          reuseExistingServer: !process.env.CI,
          timeout: 15_000,
          stdout: 'ignore',
          stderr: 'pipe',
        },
      }
    : {}),

  use: {
    // URL de base — surcharger via BASE_URL=https://komerce.co/boutique/
    baseURL,

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
    // ── Setup (auth) ──────────────────────────────────────────────────────
    // Génère playwright/.auth/user.json une fois, avant le projet "authenticated".
    // Ignoré silencieusement si TEST_ACCOUNT_PHONE/TEST_ACCOUNT_OTP absents
    // (voir tests/e2e/auth.setup.js) — n'affecte pas les projets publics.
    {
      name: 'setup',
      testMatch: /auth\.setup\.js/,
      use: { ...devices['Desktop Chrome'], locale: 'fr-FR' },
    },

    // ── Authentifié ─────────────────────────────────────────────────────────
    // Réservé aux specs dans tests/e2e/authenticated/ (voir README associé).
    // Compte de test dédié uniquement — jamais un compte réel/production.
    {
      name: 'authenticated',
      testDir: './tests/e2e/authenticated',
      testMatch: ['**/*.spec.js'],
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        locale: 'fr-FR',
        storageState: 'playwright/.auth/user.json',
      },
    },

    // ── Desktop (public, sans session) ─────────────────────────────────────
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
