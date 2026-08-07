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

  test('un inventaire SKU conserve le bouton Ajouter visible (sauf si explicitement masqué ailleurs, ex. mode édition liste)', () => {
    const css = fs.readFileSync(cssPath, 'utf8');
    // Mandat §3.2 (correctif capture production) — :not([hidden]) ajouté
    // pour que ce garde respecte un masquage JS explicite (mode édition
    // de liste), sans quoi il gagnait toujours contre .k-add-cart-btn[hidden]
    // (css/modal-shell.css) même pour un produit SKU.
    expect(css).toMatch(/data-inventory-model="SKU"[^}]*\.k-add-cart-btn:not\(\[hidden\]\)\s*\{[^}]*display:\s*flex/m);
    expect(css).not.toMatch(/!important/);
  });

  test('la garde est incluse dans le bundle components', () => {
    const { BUNDLES } = require(bundleConfigPath);
    const components = BUNDLES.find((bundle) => bundle.out === 'components.css');
    expect(components.files).toContain('modal-cart-sku-guard');
  });
});
