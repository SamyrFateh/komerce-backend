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

// ── [R5] FAIL-CLOSED — garde anti-prod pour les tests mutants ────────────────
// Si BASE_URL pointe la production (komerce.co), les specs mutantes
// (cancel-refund, stress-business, wallet-lifecycle, wallet-payment)
// sont refusées ici ET dans leur propre beforeAll (assertNotProdIfMutant).
// Deux couches de protection pour qu'un run direct (`playwright test spec.js`)
// sans passer par e2e-business-run.js soit aussi bloqué.
const PROD_GUARD_HOSTS = ['komerce.co'];
const MUTANT_SPEC_NAMES = ['cancel-refund', 'stress-business', 'wallet-lifecycle', 'wallet-payment'];
if (isRemote && !process.env.ALLOW_MUTANTS_ON_PROD) {
  const isProd = PROD_GUARD_HOSTS.some(h => baseURL.includes(h));
  if (isProd) {
    const argv = process.argv.join(' ');
    const hasMutant = MUTANT_SPEC_NAMES.some(s => argv.includes(s));
    if (hasMutant) {
      // eslint-disable-next-line no-console
      console.error(
        `\n[R5][FAIL-CLOSED] ⛔ Test mutant refusé sur URL de production "${baseURL}".\n` +
        `  Utiliser staging ou ALLOW_MUTANTS_ON_PROD=1 (dangereux).\n`
      );
      process.exit(2);
    }
  }
}
// ─────────────────────────────────────────────────────────────────────────────

module.exports = defineConfig({
  testDir: './tests',
  testMatch: ['**/e2e/**/*.spec.js', '**/contracts.spec.js'],

  // Timeout global par test (30s en LOCAL). En DISTANT, certains specs
  // enchaînent plusieurs cycles de timeout API (ex. E15 : wallet → track →
  // group, ~10s chacun via K.request DEFAULT_TIMEOUT_MS) + latence réseau
  // réelle vers komerce.co — 30s est trop juste et casse au 2e/3e cycle
  // sans qu'il y ait de bug fonctionnel. Mesuré à 45s : Desktop Chrome
  // dépasse tout juste (45.1s) sur le 3e cycle (onglet group), Mobile
  // Chrome passe avec seulement ~4s de marge (40.8s). 60s en DISTANT
  // laisse une marge réelle aux deux navigateurs.
  timeout: isRemote ? 60_000 : 30_000,

  // Relance automatique en cas d'échec flaky (CI uniquement)
  retries: process.env.CI ? 2 : 0,

  // En mode DISTANT, tous les specs `authenticated/` partagent le même
  // storageState (playwright/.auth/user.json) ET le même compte réel de
  // staging. Le paralléliser entre plusieurs specs (workers > 1) fait muter
  // panier/wallet/session en concurrence par plusieurs workers à la fois —
  // observé concrètement : contexte navigateur fermé en plein test (R1),
  // sans rapport avec un vrai bug métier. 1 worker = specs authenticated
  // strictement séquentiels, quel que soit le nombre de fichiers passés en
  // ligne de commande.
  workers: isRemote ? 1 : undefined,

  // Rapport lisible en local, JUnit en CI
  reporter: process.env.CI
    ? [['junit', { outputFile: 'test-results/results.xml' }], ['list']]
    : [['html', { open: 'never' }], ['list']],

  // Volet 3.3 — tolérance de diff pixel pour toHaveScreenshot(). Calibré sur
  // mesure réelle (pas au jugé), re-vérifiée le 26/07 dans cet environnement :
  // la même régression volontaire (couleur du bouton WhatsApp) ne produit
  // que ~0.22-0.23% de pixels différents sur l'état mobile-simple (mesuré à
  // ImageMagick `compare -metric AE` : 741/329160 px) — le bouton y occupe
  // une petite portion du cadre. L'ancien seuil (0.002 = 0.2%) était donc
  // TROP PRÈS de ce signal réel : il laissait passer cette régression sous
  // pixelmatch (qui exclut les pixels d'anti-aliasing du compte). 0.001
  // (0.1%) reste net en dessous du signal réel mesuré sur le cas le plus
  // défavorable (mobile-simple) tout en absorbant l'anti-aliasing
  // sous-pixel entre environnements (OS/GPU). Voir l'avertissement de
  // portabilité en tête de tests/e2e/modal-visual-regression.spec.js.
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.001 },
  },

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

    // ── MDM-9 — Projet dédié layout galerie modale (§5) ────────────────────
    // Le spec modal-mdm9-gallery-layout.spec.js boucle en interne sur
    // 3 viewports (360×800, 390×844, 1280×800). Ce projet Chromium dédié
    // évite que le spec soit rejoué sur les 5 projets navigateur standards,
    // ce qui créerait une matrice involontaire de 9×5 = 45 tests.
    // Les viewports sont gérés par test.use() dans le spec lui-même.
    {
      name: 'Chromium MDM-9',
      testMatch: '**/modal-mdm9-gallery-layout.spec.js',
      use: {
        ...devices['Desktop Chrome'],
        locale: 'fr-FR',
      },
    },

    // ── Volets 3.2/3.3 — Projet dédié specs LOCAL-only ─────────────────────
    // modal-geometry.spec.js (mesures getBoundingClientRect) et
    // modal-visual-regression.spec.js (toHaveScreenshot) stubbent l'API via
    // page.route et gèrent leurs propres viewports en interne (test.use côté
    // spec) — même raison qu'MDM-9 : projet Chromium unique dédié pour éviter
    // la multiplication ×5 navigateurs. Ces specs dépendent de données
    // déterministes (fixtures) plutôt que du backend réel : les exécuter en
    // DISTANT contre le catalogue live romprait le déterminisme des captures
    // (volet 3.3) sans rien gagner (volet 3.2 ne teste que du layout/CSS).
    {
      name: 'Chromium Local-Only',
      testMatch: ['**/modal-geometry.spec.js', '**/modal-visual-regression.spec.js', '**/hero-geometry.spec.js', '**/modal-backtop-zindex.spec.js', '**/csp-fronts.spec.js', '**/visual-geometry-audit.spec.js'],
      use: {
        ...devices['Desktop Chrome'],
        locale: 'fr-FR',
      },
    },

    // ── Desktop (public, sans session) ─────────────────────────────────────
    // testIgnore : les specs authenticated/ ont besoin du storageState posé
    // par le projet "authenticated" (dépendance sur "setup") — sans lui, un
    // fetch/UI authentifié échoue systématiquement (ex. F10 : /api/auth/me
    // → 401). Le testMatch global les matche quand même ; on les exclut
    // explicitement ici pour ne pas les rejouer en double, sans session.
    {
      name: 'Desktop Chrome',
      testIgnore: ['**/authenticated/**', '**/modal-mdm9-gallery-layout.spec.js', '**/modal-geometry.spec.js', '**/modal-visual-regression.spec.js', '**/hero-geometry.spec.js', '**/modal-backtop-zindex.spec.js', '**/csp-fronts.spec.js', '**/visual-geometry-audit.spec.js'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        locale: 'fr-FR',
      },
    },
    {
      name: 'Desktop Firefox',
      testIgnore: ['**/authenticated/**', '**/modal-mdm9-gallery-layout.spec.js', '**/modal-geometry.spec.js', '**/modal-visual-regression.spec.js', '**/hero-geometry.spec.js', '**/modal-backtop-zindex.spec.js', '**/csp-fronts.spec.js', '**/visual-geometry-audit.spec.js'],
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1280, height: 800 },
        locale: 'fr-FR',
      },
    },
    {
      name: 'Desktop Safari',
      testIgnore: ['**/authenticated/**', '**/modal-mdm9-gallery-layout.spec.js', '**/modal-geometry.spec.js', '**/modal-visual-regression.spec.js', '**/hero-geometry.spec.js', '**/modal-backtop-zindex.spec.js', '**/csp-fronts.spec.js', '**/visual-geometry-audit.spec.js'],
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1280, height: 800 },
        locale: 'fr-FR',
      },
    },

    // ── Mobile (la boutique est mobile-first — diaspora comorienne) ─────────
    {
      name: 'Mobile Chrome',
      testIgnore: ['**/authenticated/**', '**/modal-mdm9-gallery-layout.spec.js', '**/modal-geometry.spec.js', '**/modal-visual-regression.spec.js', '**/hero-geometry.spec.js', '**/modal-backtop-zindex.spec.js', '**/csp-fronts.spec.js', '**/visual-geometry-audit.spec.js'],
      use: {
        ...devices['Pixel 7'],
        locale: 'fr-FR',
      },
    },
    {
      name: 'Mobile Safari',
      testIgnore: ['**/authenticated/**', '**/modal-mdm9-gallery-layout.spec.js', '**/modal-geometry.spec.js', '**/modal-visual-regression.spec.js', '**/hero-geometry.spec.js', '**/modal-backtop-zindex.spec.js', '**/csp-fronts.spec.js', '**/visual-geometry-audit.spec.js'],
      use: {
        ...devices['iPhone 14'],
        locale: 'fr-FR',
      },
    },
  ],

  // Dossier de sortie des rapports et screenshots
  outputDir: 'test-results/',
});
