/**
 * @komerce-arch-lite
 * @role          boutique-interactions-css-test
 * @domain        boutique
 * @layer         test
 * @status        production
 * @owner         public/boutique/tests/unit/interactions.test.js
 * @purpose       Protects the greeting chip stacking order relative to the desktop cart.
 * @impact-areas  boutique, css
 * @version       2026-11
 * @test-kind     unit
 * @test-runner   jest
 * @test-requires none
 */
'use strict';

const fs = require('fs');
const path = require('path');

const cssDir = path.resolve(__dirname, '../../css');

function readCss(file) {
  return fs.readFileSync(path.join(cssDir, file), 'utf8');
}

describe('Boutique greeting/cart stacking', () => {
  it('keeps the non-interactive greeting below desktop cart controls', () => {
    const interactions = readCss('interactions.css');
    const desktop = readCss('boutique-desktop.css');
    const greeting = interactions.match(/#k-greeting-chip\s*\{([^}]+)\}/s)?.[1] ?? '';
    const cart = desktop.match(/\.k-side-cart\s*\{([^}]+)\}/s)?.[1] ?? '';

    expect(greeting).toMatch(/z-index\s*:\s*190\b/);
    expect(cart).toMatch(/z-index\s*:\s*200\b/);
    expect(greeting).toMatch(/pointer-events\s*:\s*none/);
  });
});
