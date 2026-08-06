'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');
const { BUNDLES } = require('../../scripts/css-bundles');

const cssPath = path.resolve(__dirname, '../../css/shared-list-side-cart-responsive.css');
const css = fs.readFileSync(cssPath, 'utf8');

function compact(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

describe('liste partageable — layout étroit side cart / drawer', () => {
  it('charge les corrections après la feuille de base dans components.css', () => {
    const components = BUNDLES.find((bundle) => bundle.out === 'components.css');
    expect(components).toBeDefined();

    const baseIndex = components.files.indexOf('shared-list-side-cart');
    const responsiveIndex = components.files.indexOf('shared-list-side-cart-responsive');

    expect(baseIndex).toBeGreaterThanOrEqual(0);
    expect(responsiveIndex).toBe(baseIndex + 1);
  });

  it('dimensionne le panneau avec le switch sans conserver height:100%', () => {
    const normalized = compact(css);
    expect(normalized).toContain(
      '#k-side-cart[data-mode="shared-list"] > .k-shared-list-panel, #k-side-cart[data-mode="library"] > .k-shared-list-panel'
    );
    expect(normalized).toMatch(/height:\s*auto/);
    expect(normalized).toMatch(/flex:\s*1 1 auto/);
    expect(normalized).toMatch(/#k-side-cart\[data-mode="shared-list"\][\s\S]*?\.k-cart-surface-switch[\s\S]*?order:\s*2/);
  });

  it('utilise une container query adaptée au side cart desktop étroit', () => {
    expect(css).toMatch(/container-name:\s*shared-list/);
    expect(css).toMatch(/container-type:\s*inline-size/);
    expect(css).toMatch(/@container\s+shared-list\s*\(max-width:\s*420px\)/);
  });

  it('sépare produit, quantité et actions pour empêcher les chevauchements', () => {
    const normalized = compact(css);
    expect(normalized).toContain('grid-template-areas: "product product" "quantity actions";');
    expect(normalized).toMatch(/\.k-shared-item-open\s*\{[^}]*grid-area:\s*product/);
    expect(normalized).toMatch(/\.k-shared-item-qty\s*\{[^}]*grid-area:\s*quantity/);
    expect(normalized).toMatch(/\.k-shared-item-controls\s*\{[^}]*grid-area:\s*actions/);
  });

  it('réserve une colonne image stable et garde le prix/statut lisibles', () => {
    expect(css).toMatch(/grid-template-columns:\s*56px\s+minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/\.k-shared-item-open \.k-cart-item-img\s*\{[^}]*width:\s*56px[^}]*height:\s*56px/s);
    expect(css).toMatch(/\.k-shared-item-meta\s*\{[^}]*display:\s*flex[^}]*font-weight:\s*700/s);
    expect(css).toMatch(/\.k-shared-item-status\s*\{[^}]*flex-basis:\s*100%/s);
  });

  it('stabilise le fallback image et le footer d’achat', () => {
    expect(css).toMatch(/\.k-shared-list-item \.k-cart-item-img-el\s*\{[^}]*object-fit:\s*cover/s);
    expect(css).toMatch(/\.k-shared-list-item \.k-cart-item-img\.is-img-error \.k-cart-item-img-fallback/);
    expect(css).toMatch(/\.k-shared-list-footer\s*\{[^}]*background:\s*var\(--surface-sand-97\)/s);
    expect(css).toMatch(/#k-shared-list-buy\s*\{[^}]*min-height:\s*48px/s);
  });
});
