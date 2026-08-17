'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  sourceStem,
  testStem,
  stemsMatch,
  isRootSource,
  isBoutiqueSource,
  isRootUnitTest,
  isBoutiqueUnitTest,
} = require('../../scripts/run-staged-related-tests');

describe('run-staged-related-tests — resolution ciblee', () => {
  test('associe exactement une source a son test homonyme', () => {
    expect(sourceStem('services/suppliers/normalized-product.js')).toBe('normalized-product');
    expect(testStem('tests/unit/normalized-product.test.js')).toBe('normalized-product');
    expect(stemsMatch(
      'services/suppliers/normalized-product.js',
      'tests/unit/normalized-product.test.js',
    )).toBe(true);
  });

  test('n elargit pas artificiellement un stem voisin', () => {
    expect(stemsMatch(
      'public/boutique/js/b-cart.js',
      'public/boutique/tests/unit/cart.test.js',
    )).toBe(false);
  });

  test('classe seulement le code runtime backend dans le workspace racine', () => {
    expect(isRootSource('services/orders.js')).toBe(true);
    expect(isRootSource('routes/orders.js')).toBe(true);
    expect(isRootSource('server.js')).toBe(true);
    expect(isRootSource('scripts/tool.js')).toBe(false);
    expect(isRootSource('public/boutique/js/b-cart.js')).toBe(false);
  });

  test('classe seulement le runtime Boutique JS dans le workspace Boutique', () => {
    expect(isBoutiqueSource('public/boutique/js/b-cart.js')).toBe(true);
    expect(isBoutiqueSource('public/boutique/css/cart.css')).toBe(false);
    expect(isBoutiqueSource('public/boutique/tests/unit/b-cart.test.js')).toBe(false);
  });

  test('separe les tests unitaires locaux des tests integration/E2E', () => {
    expect(isRootUnitTest('tests/unit/normalized-product.test.js')).toBe(true);
    expect(isRootUnitTest('tests/integration/orders.test.js')).toBe(false);
    expect(isBoutiqueUnitTest('public/boutique/tests/unit/b-cart.test.js')).toBe(true);
    expect(isBoutiqueUnitTest('public/boutique/tests/e2e/cart.spec.js')).toBe(false);
  });
});
