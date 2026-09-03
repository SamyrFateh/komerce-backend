'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @feature catalog
 */
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(
  path.resolve(__dirname, '../../css/category-cutout-navigation.css'),
  'utf8'
);

describe('Active category luminous signal', () => {
  test('affiche un voyant circulaire lumineux uniquement sur la catégorie active mobile', () => {
    expect(css).toMatch(
      /\.k-shelf-rail\s+\.k-cat-cutout\s+\.k-chip-photo::after\s*\{[^}]*width:\s*8px[^}]*height:\s*8px[^}]*border-radius:\s*50%[^}]*opacity:\s*0[^}]*z-index:\s*3/s
    );
    expect(css).toMatch(
      /\.k-shelf-rail\s+\.k-cat-cutout\.active\s+\.k-chip-photo::after\s*\{[^}]*opacity:\s*1[^}]*transform:\s*scale\(1\)/s
    );
    expect(css).toMatch(
      /\.k-shelf-rail\s+\.k-cat-cutout\s+\.k-chip-photo::after\s*\{[^}]*radial-gradient\([^}]*var\(--white\)[^}]*var\(--ocean\)[^}]*box-shadow:[^}]*var\(--ocean-dark\)/s
    );
    expect(css).not.toMatch(
      /\.k-shelf-rail\s+\.k-cat-cutout\.active\s+\.k-chip-photo::after\s*\{[^}]*animation:/s
    );
  });
});
