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

  it('propose une interface mobile compacte sans nouveau breakpoint ni faux parcours', () => {
    const normalized = compact(css);
    expect(css).toContain('@media (max-width: 899px)');
    expect(normalized).toMatch(/\.k-order-overlay\.open \.ck-mobile-relay-heading \{[^}]*display: flex/);
    expect(normalized).toMatch(/\.k-order-overlay\.open \.ck-checkout-aside \.ck-checkout-heading \{ display: none/);
    expect(normalized).toMatch(/\.k-order-overlay\.open \.ck-recap-toggle \{[^}]*min-height: 46px/);
    expect(normalized).toMatch(/\.k-order-overlay\.open \.ck-recap-subtotal \{[^}]*--cream-amber-bg/);
    expect(normalized).toMatch(/\.k-order-overlay\.open \.ck-confirm-btn:not\(:disabled\) \{[^}]*--checkout-accent-deep/);
  });

  it('livre le checkout mobile dans le bundle réel et invalide son cache CSS', () => {
    const served = fs.readFileSync(path.join(__dirname, '../../css/dist/components.css'), 'utf8');
    const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
    expect(served).toContain('Checkout mobile compact V2');
    expect(served).toContain('.k-order-overlay.open .ck-mobile-relay-heading {');
    expect(served).toContain('display: flex;');
    expect(html).toContain('components.css?v=661');
  });

  it('le corps du checkout réduit son padding horizontal de façon fluide', () => {
    const normalized = compact(css);
    expect(normalized).toMatch(
      /\.k-order-overlay\.open \.k-order-body--checkout \{[^}]*padding: 16px clamp\(12px, 4vw, 18px\) 18px;/
    );
  });
});
