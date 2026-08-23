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
});
