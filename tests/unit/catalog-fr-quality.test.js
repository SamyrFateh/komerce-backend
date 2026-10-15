'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { MARKETING_NOISE, looksFrench, englishResidues } = require('../../services/catalog-fr-quality');

describe('catalog-fr-quality : export MARKETING_NOISE réutilisable (completion-at-contact)', () => {
  test('expose la liste de bruit marketing déjà utilisée par evaluateFrenchCopy, pour réutilisation hors module', () => {
    expect(Array.isArray(MARKETING_NOISE)).toBe(true);
    expect(MARKETING_NOISE.length).toBeGreaterThan(0);
    expect(MARKETING_NOISE.every((pattern) => pattern instanceof RegExp)).toBe(true);
    expect(MARKETING_NOISE.some((pattern) => pattern.test('Hot Sale'))).toBe(true);
    expect(MARKETING_NOISE.some((pattern) => pattern.test('Free Shipping'))).toBe(true);
  });

  test('looksFrench/englishResidues restent inchangés (déjà couverts indirectement par les tests FR Quality Pass)', () => {
    expect(looksFrench('Produit confortable avec une excellente résistance.')).toBe(true);
    expect(englishResidues('Comfortable wireless headset.')).toEqual(
      expect.arrayContaining(['comfortable', 'wireless'])
    );
  });
});
