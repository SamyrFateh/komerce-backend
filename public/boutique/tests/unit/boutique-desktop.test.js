'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.resolve(__dirname, '../../css/boutique-desktop.css'), 'utf8');

describe('boutique desktop — surface du side cart', () => {
  it('forme une coque blanche ouverte, sans cadre ni ombre diffuse', () => {
    const shell = css.match(/\.k-side-cart\s*\{([^}]+)\}/s)?.[1] || '';
    expect(shell).toMatch(/background\s*:\s*var\(--white\)/);
    expect(shell).toMatch(/border\s*:\s*none/);
    expect(shell).not.toMatch(/border-left/);
    expect(shell).toMatch(/box-shadow\s*:\s*none/);
    expect(css).toMatch(/html\.k-home-premium-v1 \.k-side-cart\s*\{[^}]*box-shadow:\s*none/s);
  });

  it('retire tout récapitulatif transactionnel quand le panier de la fiche produit est vide', () => {
    expect(css).toMatch(
      /\.k-side-cart--in-modal:has\(\.k-sc-empty\) \.k-sc-header\s*\{[^}]*display\s*:\s*none/s,
    );
  });
});
