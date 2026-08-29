'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');
const importantGate = require('../../scripts/check-important.js');

const readBoutiqueFile = (relativePath) => fs.readFileSync(
  path.join(__dirname, '..', '..', relativePath),
  'utf8',
);

describe('check-important — dette ouverte vs guards revus', () => {
  test('état réel : 5 physiques = 3 revues + 2 ouvertes', () => {
    const result = importantGate.scan();

    expect(result.total).toBe(5);
    expect(result.reviewedTotal).toBe(3);
    expect(result.openTotal).toBe(2);
    expect(result.reviewedPerFile).toEqual({ 'boutique-desktop.css': 3 });
    expect(result.openPerFile).toEqual({
      'share-cart.css': 2,
    });
  });

  test('le spacer header appartient à layout.css, jamais au markup ni au hero', () => {
    const index = readBoutiqueFile('index.html');
    const layout = readBoutiqueFile('css/layout.css');
    const hero = readBoutiqueFile('css/hero.css');

    expect(index).toContain('<div id="k-header-spacer"></div>');
    expect(index).not.toMatch(/id="k-header-spacer"[^>]*style=/);
    expect(layout).toContain(
      '#k-header-spacer {\n  height: calc(var(--header-h, 56px) + env(safe-area-inset-top, 0px));\n  flex-shrink: 0;\n}',
    );
    expect(layout).toContain('#k-header-spacer { height: 0; }');
    expect(hero).not.toContain('#k-header-spacer');
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
      total: 2,
      perFile: { 'share-cart.css': 2 },
    };

    const diff = importantGate.diffAgainstBaseline(synthetic, baseline);
    expect(diff.regressions).toEqual([{ file: 'tokens.css', ref: 0, now: 1 }]);
  });
});
