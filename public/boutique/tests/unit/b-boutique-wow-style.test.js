'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/b-boutique-wow-style.test.js
 *
 * js/b-boutique-wow-style.js — module désactivé (couche wow supprimée,
 * cf. docstring du fichier). setupBoutiqueWowStyle() est un no-op assumé.
 * Le test fige ce contrat : appelable sans erreur, sans effet de bord DOM,
 * pour détecter toute réactivation accidentelle de logique dans ce fichier.
 */

const { setupBoutiqueWowStyle } = require('../../js/b-boutique-wow-style.js');

describe('b-boutique-wow-style', () => {
  test('setupBoutiqueWowStyle() ne fait rien (no-op assumé)', () => {
    const bodyHtmlBefore = document.body.innerHTML;
    const headHtmlBefore = document.head.innerHTML;

    expect(() => setupBoutiqueWowStyle()).not.toThrow();

    expect(document.body.innerHTML).toBe(bodyHtmlBefore);
    expect(document.head.innerHTML).toBe(headHtmlBefore);
  });

  test('setupBoutiqueWowStyle() ne retourne rien', () => {
    expect(setupBoutiqueWowStyle()).toBeUndefined();
  });

  test('appels multiples restent sans effet (idempotence triviale)', () => {
    expect(() => {
      setupBoutiqueWowStyle();
      setupBoutiqueWowStyle();
      setupBoutiqueWowStyle();
    }).not.toThrow();
  });
});
