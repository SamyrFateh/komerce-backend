'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.resolve(__dirname, '../../css/shared-list-side-cart.css'), 'utf8');

describe('shared list side cart — hiérarchie des surfaces', () => {
  it('garde le drawer blanc avec ses lignes snapshot sable', () => {
    expect(css).toMatch(/\.k-cart-snapshot-item\s*\{[^}]*background:\s*var\(--sand\)/s);
    expect(css).toMatch(/\.k-cart-drawer\[data-mode="shared-list"\]\s+#k-cart-body\s*\{[^}]*background:\s*var\(--white\)/s);
    expect(css).toMatch(/\.k-cart-drawer\[data-mode="shared-list"\]\s*\{[^}]*background:\s*var\(--white\)/s);
  });
});
