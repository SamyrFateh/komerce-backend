'use strict';

/**
 * tests/unit/b-group-cart-flow.test.js
 *
 * js/b-group-cart-flow.js — @deprecated PR-1 (2026-05-24), conservé comme
 * stub vide pour ne pas casser l'import dynamique fait par
 * b-cart-product-open-style.js. setupGroupCartFlow() est un no-op assumé
 * ciblant des sélecteurs (#k-sc-group, .k-sc-btn-group, #k-cart-event-btn)
 * qui n'existent plus dans le DOM depuis la PR 1.
 *
 * Le test fige le contrat de stub : appelable sans erreur même si ces
 * sélecteurs sont absents (cas nominal actuel) ou encore présents par
 * accident (régression de nettoyage HTML).
 */

const { setupGroupCartFlow } = require('../../js/b-group-cart-flow.js');
const { mountFixture } = require('./helpers/boutiqueTestKit.js');

describe('b-group-cart-flow (stub déprécié)', () => {
  test('setupGroupCartFlow() ne fait rien quand les anciens sélecteurs sont absents', () => {
    mountFixture('<div id="k-catalog-section"></div>');

    expect(() => setupGroupCartFlow()).not.toThrow();
    expect(setupGroupCartFlow()).toBeUndefined();
  });

  test('setupGroupCartFlow() reste un no-op même si les anciens sélecteurs existent encore', () => {
    // Cas défensif : si #k-sc-group traîne encore dans un vieux fragment HTML,
    // le stub ne doit toujours produire aucun effet.
    mountFixture(`
      <div id="k-sc-group"></div>
      <button class="k-sc-btn-group"></button>
      <button id="k-cart-event-btn"></button>
    `);
    const before = document.getElementById('boutique-test-root').innerHTML;

    setupGroupCartFlow();

    expect(document.getElementById('boutique-test-root').innerHTML).toBe(before);
  });
});
