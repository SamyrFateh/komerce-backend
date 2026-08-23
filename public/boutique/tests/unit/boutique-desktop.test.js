'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.resolve(__dirname, '../../css/boutique-desktop.css'), 'utf8');

describe('boutique desktop — cadre du side cart', () => {
  it('forme une coque blanche continue sans ombre diffuse', () => {
    const shell = css.match(/\.k-side-cart\s*\{([^}]+)\}/s)?.[1] || '';
    expect(shell).toMatch(/background\s*:\s*var\(--white\)/);
    expect(shell).toMatch(/border-left\s*:\s*1px\s+solid\s+var\(--border\)/);
    expect(shell).toMatch(/box-shadow\s*:\s*none/);
    expect(css).toMatch(/html\.k-home-premium-v1 \.k-side-cart\s*\{[^}]*box-shadow:\s*none/s);
  });
});
