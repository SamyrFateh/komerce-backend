/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   modal-backtop-zindex.spec.js
 * @feature modal-product
 * @brief P0-A #4 — verrouille l'atteignabilité du bouton « retour en haut »
 *        de la modale produit quand celle-ci est ouverte : il doit être
 *        l'élément réellement cliqué à son point central (jamais recouvert
 *        par l'overlay). Gabarit : harnais/geometry/verify-backtop-zindex.js
 *        — ce spec câble la même mesure (elementFromPoint) dans la suite.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const modalMarkup = require('../../../../tools/boutique-harnais/geometry/extract').modal();

const FIXTURE_URL = '__b1_modal_fixture.html';

function pageHtml() {
  return `<!DOCTYPE html><html class="k-home-premium-v1"><head><meta charset=utf-8>
<link rel=stylesheet href=/boutique/css/dist/base.css>
<link rel=stylesheet href=/boutique/css/dist/components.css>
<link rel=stylesheet href=/boutique/css/dist/desktop.css></head>
<body class="modal-open">${modalMarkup}
<button id="k-modal-back-top" class="k-modal-back-top visible" aria-label="Retour au produit">↑</button>
<script>document.getElementById('k-modal-overlay').classList.add('open');</script></body></html>`;
}

test.describe('Modale produit — bouton retour en haut (volet P0-A #4)', () => {
  test('le bouton est réellement atteignable au clic quand la modale est ouverte', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 860 });
    await page.route('**/boutique/' + FIXTURE_URL, route => route.fulfill({ status: 200, contentType: 'text/html', body: pageHtml() }));
    await page.goto(FIXTURE_URL);
    await page.waitForTimeout(150);

    const info = await page.evaluate(() => {
      const fab = document.getElementById('k-modal-back-top');
      const b = fab.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return {
        cliquable: hit === fab || fab.contains(hit),
        hitTag: hit ? (hit.id || hit.className || hit.tagName) : 'null',
      };
    });

    expect(info.cliquable, `élément réellement au point du clic : ${info.hitTag}`).toBe(true);
  });
});
