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

  test('un inventaire SKU masque toujours le stepper product-level', () => {
    const css = fs.readFileSync(cssPath, 'utf8');
    expect(css).toMatch(/data-inventory-model="SKU"[^}]*\.k-qty\s*\{[^}]*display:\s*none/m);
  });

  test('un inventaire SKU conserve le bouton Ajouter visible', () => {
    const css = fs.readFileSync(cssPath, 'utf8');
    expect(css).toMatch(/data-inventory-model="SKU"[^}]*\.k-add-cart-btn\s*\{[^}]*display:\s*flex/m);
    expect(css).not.toMatch(/!important/);
  });

  test('la garde est incluse dans le bundle components', () => {
    const { BUNDLES } = require(bundleConfigPath);
    const components = BUNDLES.find((bundle) => bundle.out === 'components.css');
    expect(components.files).toContain('modal-cart-sku-guard');
  });
});
