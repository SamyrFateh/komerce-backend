'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @feature catalog
 */
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.resolve(__dirname, '../../css/mobile-catalog-convergence.css'), 'utf8');

describe('mobile catalog convergence', () => {
  test('ouvre le hero et le rail sans cadre permanent', () => {
    expect(css).toContain('@media (max-width: 899px)');
    expect(css).toContain('var(--ocean-bg-08)');
    expect(css).toContain('var(--coral-focus-08)');
    expect(css).toMatch(/\.k-hero \.k-hero-inner \.k-hero-media\s*\{[^}]*border-radius:\s*0[^}]*background:\s*transparent[^}]*box-shadow:\s*none/s);
    expect(css).toMatch(/\.k-shelf-rail\s*\{[^}]*background:\s*var\(--white\)[^}]*box-shadow:\s*none/s);
  });

  test('réserve la recherche sous les catégories dans chaque page Temu', () => {
    expect(css).toMatch(/#k-grid\.k-grid-cat-pager:not\(\.k-grid-flat-subcat\) > \.k-cat-section\s*\{[^}]*padding-top:\s*42px/s);
  });

  test('densifie la carte de scan sans reprendre son owner racine', () => {
    expect(css).toContain('background: var(--cta-green);');
    expect(css).toMatch(/\.k-card-img-wrap\s*\{[^}]*aspect-ratio:\s*4 \/ 3/s);
    expect(css).toMatch(/\.k-card-info\s*\{[^}]*padding:\s*6px 8px 7px/s);
    expect(css).toMatch(/\.k-card-name\s*\{[^}]*font-size:\s*13px[^}]*font-weight:\s*500[^}]*line-height:\s*1\.18/s);
    expect(css).toMatch(/\.k-card-price-col\s*\{[^}]*min-height:\s*30px/s);
    expect(css).toMatch(/\.k-card-price\s*\{[^}]*font-size:\s*17px/s);
    expect(css).not.toMatch(/\n\s*\.k-card\s*\{/);
    expect(css).not.toContain('.k-card-fav');
  });
});
