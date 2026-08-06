'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * @komerce-arch-lite
 * @role          shared-cart-snapshot-narrow-layout-css-tests
 * @domain        shared-cart
 * @layer         test
 * @status        production
 * @owner         public/boutique/tests/unit/shared-list-responsive-layout.test.js
 * @purpose       Verrouille le CSS de la ligne de snapshot dans les
 *                conteneurs étroits (side cart desktop ~330px, drawer
 *                mobile) contre css/shared-list-side-cart-responsive.css.
 *                Lot D : réécrit contre .k-cart-snapshot-item* et l'ancrage
 *                container-query #k-side-cart (panneau .k-shared-list-panel
 *                démantelé en Lot A, plus de hack flex `order`).
 * @impact-areas  shared-cart, css, boutique
 * @version       2026-08-lotD
 */
const fs = require('fs');
const path = require('path');
const { BUNDLES } = require('../../scripts/css-bundles');

const cssPath = path.resolve(__dirname, '../../css/shared-list-side-cart-responsive.css');
const css = fs.readFileSync(cssPath, 'utf8');

function compact(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

/**
 * Lot D (refactor soustractif shared-cart, clôture) — ce fichier testait
 * .k-shared-list-panel / .k-shared-item-* et un hack flex `order` destiné
 * à repositionner un panneau propre à côté du switch [Panier]/[Liste].
 * Ce panneau a été démantelé en Lot A : les lignes s'écrivent désormais
 * directement dans les conteneurs canoniques (#k-sc-items, #k-cart-body),
 * et .k-cart-surface-switch est prepend()é devant eux à chaque rendu
 * (group-side-cart.js::renderCartSurfaceSwitch) — l'ordre visuel vient de
 * l'ordre DOM naturel, plus d'un hack `order` CSS séparé. Les tests
 * couplés à ce mécanisme retiré sont supprimés ; ceux qui couvrent un
 * invariant toujours vrai sont réécrits contre .k-cart-snapshot-item et
 * #k-side-cart (nouvel ancrage du container query, voir le fichier CSS).
 */
describe('liste partageable — layout étroit side cart / drawer', () => {
  it('charge les corrections après la feuille de base dans components.css', () => {
    const components = BUNDLES.find((bundle) => bundle.out === 'components.css');
    expect(components).toBeDefined();

    const baseIndex = components.files.indexOf('shared-list-side-cart');
    const responsiveIndex = components.files.indexOf('shared-list-side-cart-responsive');

    expect(baseIndex).toBeGreaterThanOrEqual(0);
    expect(responsiveIndex).toBe(baseIndex + 1);
  });

  it('utilise une container query adaptée au side cart desktop étroit, ancrée sur #k-side-cart (plus de panneau propre)', () => {
    expect(css).toMatch(/#k-side-cart\s*\{[^}]*container-name:\s*shared-list/s);
    expect(css).toMatch(/#k-side-cart\s*\{[^}]*container-type:\s*inline-size/s);
    expect(css).toMatch(/@container\s+shared-list\s*\(max-width:\s*420px\)/);
  });

  it('sépare produit, quantité et actions pour empêcher les chevauchements', () => {
    const normalized = compact(css);
    expect(normalized).toContain('grid-template-areas: "product product" "quantity actions";');
    expect(normalized).toMatch(/\.k-cart-snapshot-item-open\s*\{[^}]*grid-area:\s*product/);
    expect(normalized).toMatch(/\.k-cart-snapshot-item \.k-cart-item-qty\s*\{[^}]*grid-area:\s*quantity/);
    expect(normalized).toMatch(/\.k-cart-snapshot-item-controls\s*\{[^}]*grid-area:\s*actions/);
  });

  it('réserve une colonne image stable et garde le prix/statut lisibles', () => {
    expect(css).toMatch(/grid-template-columns:\s*56px\s+minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/\.k-cart-snapshot-item-open \.k-cart-item-img\s*\{[^}]*width:\s*56px[^}]*height:\s*56px/s);
    expect(css).toMatch(/\.k-cart-snapshot-item-meta\s*\{[^}]*display:\s*flex[^}]*font-weight:\s*700/s);
    expect(css).toMatch(/\.k-cart-snapshot-item-status\s*\{[^}]*flex-basis:\s*100%/s);
  });

  it('stabilise le fallback image sur la ligne de snapshot', () => {
    expect(css).toMatch(/\.k-cart-snapshot-item \.k-cart-item-img-el\s*\{[^}]*object-fit:\s*cover/s);
    expect(css).toMatch(/\.k-cart-snapshot-item \.k-cart-item-img\.is-img-error \.k-cart-item-img-fallback/);
  });

  it('conserve un repli en grille pour les navigateurs sans container queries', () => {
    expect(css).toMatch(/@supports not \(container-type: inline-size\)/);
    expect(css).toMatch(/#k-side-cart\[data-mode="shared-list"\] \.k-cart-snapshot-item\s*\{[^}]*grid-template-areas/s);
  });
});
