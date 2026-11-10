/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   hero-geometry.spec.js
 * @feature home-curation
 * @brief P0-A #3 — verrouille le plafond du hero de repli (sans classe
 *        k-home-premium-v1) à ≤ 240px sur 900/1280/1440/1920px.
 *        Gabarit : harnais/geometry/measure-hero.js — ce spec câble la
 *        même mesure dans la suite du dépôt plutôt que de la réécrire.
 *        Le markup est extrait par marqueurs (harnais/geometry/extract.js),
 *        jamais recopié à la main : index.html bouge à chaque déploiement
 *        CSS, une copie figée dériverait silencieusement du réel.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const heroMarkup = require('../../../../tools/boutique-harnais/geometry/extract').hero();

function pageHtml(withPremiumClass) {
  return `<!DOCTYPE html><html lang=fr${withPremiumClass ? ' class="k-home-premium-v1"' : ''}><head><meta charset=utf-8>
<link rel=stylesheet href=/boutique/css/dist/base.css>
<link rel=stylesheet href=/boutique/css/dist/components.css>
<link rel=stylesheet href=/boutique/css/dist/desktop.css>
</head><body>${heroMarkup}</body></html>`;
}

// Fixture HTML interceptée par Playwright : aucun fichier temporaire exposé sous public/.
const FIXTURE_URL = '__b1_hero_fixture.html';

test.describe('Hero — plafond de repli (volet P0-A #3)', () => {
  for (const width of [900, 1280, 1440, 1920]) {
    test(`SANS k-home-premium-v1 (repli) : hero <= 240px a ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.route('**/boutique/' + FIXTURE_URL, route => route.fulfill({ status: 200, contentType: 'text/html', body: pageHtml(false) }));
      await page.goto(FIXTURE_URL);
      await page.waitForTimeout(120);
      const heroHeight = await page.evaluate(() => {
        const hero = document.querySelector('.k-hero');
        return hero ? Math.round(hero.getBoundingClientRect().height) : null;
      });
      expect(heroHeight).not.toBeNull();
      expect(heroHeight).toBeLessThanOrEqual(240);
    });
  }
});
