'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const importantGate = require('../../scripts/check-important.js');

describe('check-important — dette ouverte vs guards revus', () => {
  test('état réel : 6 physiques = 3 revues + 3 ouvertes', () => {
    const result = importantGate.scan();

    expect(result.total).toBe(6);
    expect(result.reviewedTotal).toBe(3);
    expect(result.openTotal).toBe(3);
    expect(result.reviewedPerFile).toEqual({ 'boutique-desktop.css': 3 });
    expect(result.openPerFile).toEqual({
      'hero.css': 1,
      'share-cart.css': 2,
    });
  });

  test('le guard desktop exact est revu uniquement dans @media min-width 900px', () => {
    const valid = `
@media (min-width: 900px) {
  .k-cart-drawer.open,
  .k-cart-overlay.open {
    display: none !important;
    transform: translateX(100%) !important;
    pointer-events: none !important;
  }
}`;
    const global = `
.k-cart-drawer.open,
.k-cart-overlay.open {
  display: none !important;
  transform: translateX(100%) !important;
  pointer-events: none !important;
}`;

    expect(importantGate.findReviewedOccurrences('boutique-desktop.css', valid)).toHaveLength(3);
    expect(importantGate.findReviewedOccurrences('boutique-desktop.css', global)).toHaveLength(0);
  });

  test('changer une valeur invalide toute l’exception revue', () => {
    const changed = `
@media (min-width: 900px) {
  .k-cart-drawer.open,
  .k-cart-overlay.open {
    display: block !important;
    transform: translateX(100%) !important;
    pointer-events: none !important;
  }
}`;

    expect(importantGate.findReviewedOccurrences('boutique-desktop.css', changed)).toHaveLength(0);
  });

  test('une nouvelle occurrence reste une hausse de dette ouverte', () => {
    const current = importantGate.scan();
    const synthetic = {
      ...current,
      openPerFile: { ...current.openPerFile, 'tokens.css': 1 },
      openTotal: current.openTotal + 1,
    };
    const baseline = {
      total: 3,
      perFile: { 'hero.css': 1, 'share-cart.css': 2 },
    };

    const diff = importantGate.diffAgainstBaseline(synthetic, baseline);
    expect(diff.regressions).toEqual([{ file: 'tokens.css', ref: 0, now: 1 }]);
  });
});
