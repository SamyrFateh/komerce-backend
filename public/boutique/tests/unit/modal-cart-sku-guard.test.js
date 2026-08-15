'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');

describe('modal-cart-sku-guard.css', () => {
  const cssPath = path.join(__dirname, '../../css/modal-cart-sku-guard.css');
  const bundleConfigPath = path.join(__dirname, '../../scripts/css-bundles.js');

  test('un inventaire SKU affiche le stepper uniquement quand sa ligne exacte est résolue', () => {
    const css = fs.readFileSync(cssPath, 'utf8');
    expect(css).toMatch(/data-inventory-model="SKU"\]\.k-modal-actions--filled\s+\.k-qty\s*\{[^}]*display:\s*flex/m);
  });

  test('une ligne SKU résolue remplace le bouton Ajouter sans outrepasser hidden', () => {
    const css = fs.readFileSync(cssPath, 'utf8');
    expect(css).toMatch(/data-inventory-model="SKU"\]\.k-modal-actions--filled\s+\.k-add-cart-btn:not\(\[hidden\]\)\s*\{[^}]*display:\s*none/m);
    expect(css).not.toMatch(/!important/);
  });

  test('la garde est incluse dans le bundle components', () => {
    const { BUNDLES } = require(bundleConfigPath);
    const components = BUNDLES.find((bundle) => bundle.out === 'components.css');
    expect(components.files).toContain('modal-cart-sku-guard');
  });
});
