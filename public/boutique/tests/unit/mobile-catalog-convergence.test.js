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

  test('renforce les accents sans reprendre l ownership racine des cartes', () => {
    expect(css).toContain('background: var(--cta-green);');
    expect(css).toMatch(/\.k-card-name\s*\{[^}]*font-weight:\s*500/s);
    expect(css).not.toMatch(/\n\s*\.k-card\s*\{/);
    expect(css).not.toContain('.k-card-fav');
  });
});
