/**
 * @e2e   csp-fronts.spec.js
 * @feature boutique
 * @brief P0-E — ancre `harnais/geometry/audit-fronts-csp.js` comme test de
 *        premier niveau dans la suite du dépôt, sur les 7 fronts servis
 *        (au lieu d'un script qu'il faut penser à lancer à la main).
 *
 *        Rejoue la CSP RÉELLE de bootstrap/security.js (buildHelmetOptions(),
 *        pas une copie maintenue à la main) via page.route(), et compte les
 *        <script> effectivement bloqués par le navigateur sur chaque page.
 *
 *        Pourquoi page.route() et pas le webServer tel quel : en LOCAL,
 *        playwright.config.js lance `npx serve ..`, un serveur de fichiers
 *        statique qui n'envoie AUCUN header CSP (voir check-inline-scripts.js
 *        et NOTE_DE_PASSATION.md — « le symptôme n'existe qu'en conditions de
 *        production »). page.route() injecte le header de production sur la
 *        réponse HTML avant qu'elle n'atteigne le moteur de rendu : le
 *        navigateur applique alors la vraie CSP, qu'on soit en LOCAL ou en
 *        DISTANT (BASE_URL).
 *
 *        Réserve connue et volontaire (Classe C, voir NOTE_DE_PASSATION.md) :
 *        boutique/index.html porte encore 3 scripts inline non externalisés
 *        (2 `location.reload()` protecteurs, 1 mesure hero mobile à
 *        restaurer). Ce test échoue si ce nombre change, dans un sens ou
 *        l'autre — une régression ET une correction non répercutée ici sont
 *        toutes deux des dérives que ce test doit signaler.
 */
'use strict';
const path = require('path');
const { test, expect } = require('@playwright/test');
const { buildHelmetOptions } = require(path.join(__dirname, '..', '..', '..', '..', 'bootstrap', 'security.js'));

function cspHeaderFromDirectives() {
  const directives = buildHelmetOptions().contentSecurityPolicy.directives;
  return Object.entries(directives)
    .map(([key, values]) => {
      const kebab = key.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
      return `${kebab} ${values.join(' ')}`;
    })
    .join('; ');
}

const ORIGIN = process.env.BASE_URL ? new URL(process.env.BASE_URL).origin : 'http://localhost:3000';
const CSP_HEADER = cspHeaderFromDirectives();

// Les 7 fronts servis (public/*.html hors fixtures de test et rapports de
// couverture — voir AUDIT_COUTURES_COUCHES.md pour la mesure d'origine).
const FRONTS = [
  { label: 'boutique',            urlPath: '/boutique/index.html',                expectBlocked: 3 }, // Classe C réservée
  { label: 'hub',                 urlPath: '/hub/index.html',                     expectBlocked: 0 }, // P0-D
  { label: 'relais',              urlPath: '/relais/index.html',                  expectBlocked: 0 }, // P0-D
  { label: 'login',               urlPath: '/login.html',                         expectBlocked: 0 }, // P0-D
  { label: 'dashboard-admin',     urlPath: '/dashboards/admin/index.html',        expectBlocked: 0 },
  { label: 'dashboard-pilotage',  urlPath: '/dashboards/admin/portal-pilotage.html', expectBlocked: 0 },
  { label: 'dashboard-legacy-ct', urlPath: '/dashboards/admin-legacy/control-tower.html', expectBlocked: 0 },
];

test.describe('CSP — scripts réellement bloqués sur les 7 fronts servis (volet P0-D/P0-E)', () => {
  for (const front of FRONTS) {
    test(`${front.label} (${front.urlPath}) : ${front.expectBlocked} script(s) bloqué(s) attendu(s)`, async ({ page }) => {
      await page.route('**/*.html', async route => {
        const response = await route.fetch();
        const headers = { ...response.headers(), 'content-security-policy': CSP_HEADER };
        await route.fulfill({ response, headers });
      });

      const blocked = [];
      page.on('console', msg => {
        if (/Content Security Policy|Refused to execute inline script/i.test(msg.text())) {
          blocked.push(msg.text());
        }
      });

      await page.goto(`${ORIGIN}${front.urlPath}`, { waitUntil: 'load' });
      await page.waitForTimeout(1200);

      expect(blocked.length, blocked.join('\n')).toBe(front.expectBlocked);
    });
  }
});
