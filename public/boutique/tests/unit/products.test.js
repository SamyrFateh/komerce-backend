'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.resolve(__dirname, '../../css/products.css'), 'utf8');

describe('products — hiérarchie des surfaces', () => {
  it('utilise des cartes sable sur mobile et desktop', () => {
    expect(css).toMatch(/\.k-card\s*\{[^}]*background:\s*var\(--sand\)/s);
    expect(css).toMatch(/@media \(min-width: 900px\)[\s\S]*?\.k-card\s*\{[^}]*background:\s*var\(--sand\)/);
  });

  it('masque le sentinel et le spinner de pagination quand le catalogue est vide', () => {
    expect(css).toContain('#k-catalog-section:has(.k-catalog-empty) #k-scroll-sentinel');
    expect(css).toContain('#k-catalog-section:has(.k-catalog-empty) .k-load-more-spinner');
    expect(css).toMatch(/#k-catalog-section:has\(\.k-catalog-empty\)[\s\S]*?display:\s*none;/);
  });

  it('ne contient plus d\'override du spike Phase 2 (shell vertical)', () => {
    expect(css).not.toMatch(/\.spike-shell-vertical/);
  });
});

describe('lot 2 — cascade CSS sans déclaration morte (products.css)', () => {
  test('la déclaration surchargée à l\u2019identique plus loin dans la cascade a été retirée', () => {
    const css = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'css', 'products.css'), 'utf8');
    expect(css).not.toMatch(/html\.k-mobile-premium-v1 \.k-card-price \{\s*font-size: 22px/);
  });
});
