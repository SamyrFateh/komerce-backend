'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const css = fs.readFileSync(path.join(ROOT, 'css/responsive-desktop-matrix.css'), 'utf8');
const bundles = require('../../scripts/css-bundles.js').BUNDLES;
const ownership = require('../../scripts/critical-selector-ownership.js').CRITICAL_SELECTOR_OWNERSHIP;

describe('Boutique responsive matrix', () => {
  test('le fichier est chargé en dernier dans le bundle desktop', () => {
    const desktop = bundles.find(bundle => bundle.out === 'desktop.css');
    expect(desktop).toBeDefined();
    expect(desktop.files.at(-1)).toBe('responsive-desktop-matrix');
  });

  test('desktop compact 900–1199 passe à trois colonnes et réduit le side-cart', () => {
    expect(css).toMatch(/@media\s*\(min-width:\s*900px\)\s*and\s*\(max-width:\s*1199px\)/);
    expect(css).toMatch(/grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    expect(css).toMatch(/--sc-reserve-w:\s*clamp\(208px,\s*21vw,\s*224px\)/);
  });

  test('laptop standard 1200–1439 conserve quatre colonnes canoniques mais réduit la réserve', () => {
    expect(css).toMatch(/@media\s*\(min-width:\s*1200px\)\s*and\s*\(max-width:\s*1439px\)/);
    expect(css).toMatch(/--sc-reserve-w:\s*clamp\(260px,\s*20vw,\s*276px\)/);
    expect(css).not.toMatch(/@media\s*\(min-width:\s*1200px\)\s*and\s*\(max-width:\s*1439px\)[\s\S]*?repeat\(3,/);
  });

  test('grand desktop ≥1600 exploite cinq colonnes', () => {
    expect(css).toMatch(/@media\s*\(min-width:\s*1600px\)[\s\S]*?repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
  });

  test('la hauteur est traitée indépendamment de la largeur', () => {
    expect(css).toMatch(/@media\s*\(min-width:\s*900px\)\s*and\s*\(max-height:\s*800px\)/);
    expect(css).toMatch(/@media\s*\(min-width:\s*900px\)\s*and\s*\(max-width:\s*1199px\)\s*and\s*\(max-height:\s*720px\)/);
    expect(css).toContain('height: 132px !important;');
    expect(css).toContain('height: 116px !important;');
  });

  test('les adaptations critiques sont explicitement gouvernées en desktop', () => {
    for (const selector of ['.k-grid', '.k-sec-grid', '.k-side-cart', '#k-subcats-wrap']) {
      expect(ownership[selector].owners['responsive-desktop-matrix.css']).toEqual(['desktop']);
    }
  });

  test('aucune règle responsive ne transforme le breakpoint fonctionnel mobile/desktop', () => {
    expect(css).not.toMatch(/max-width:\s*899px/);
    expect(css).not.toMatch(/min-width:\s*(?:[1-8]\d\d)px/);
  });
});
