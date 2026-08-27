'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * @komerce-arch-lite
 * @role          checkout-intrinsic-responsive-css-test
 * @domain        checkout
 * @layer         test
 * @status        production
 * @owner         public/boutique/tests/unit/checkout-responsive-css.test.js
 * @purpose       Verrouille la suppression du breakpoint local 380px au profit d une géométrie intrinsèque.
 * @impact-areas  checkout, responsive-layout, payment-ui
 * @version       2026-08
 */
const fs = require('fs');
const path = require('path');

const cssPath = path.resolve(__dirname, '../../css/checkout-vertical-rail.css');
const css = fs.readFileSync(cssPath, 'utf8');

function compact(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

describe('checkout — responsive intrinsèque sans seuil local', () => {
  it('ne contient plus de breakpoint 380px', () => {
    expect(css).not.toMatch(/@media\s*\(max-width:\s*380px\)/);
    expect(css).not.toMatch(/380px/);
  });

  it('la grille destinataire replie ses cartes selon leur largeur utile', () => {
    const normalized = compact(css);
    expect(normalized).toMatch(
      /\.ck-recipient-grid \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 11\.5rem\), 1fr\)\);/
    );
  });

  it('le corps du checkout réduit son padding horizontal de façon fluide', () => {
    const normalized = compact(css);
    expect(normalized).toMatch(
      /\.k-order-overlay\.open \.k-order-body--checkout \{[^}]*padding: 16px clamp\(12px, 4vw, 18px\) 18px;/
    );
  });
});
