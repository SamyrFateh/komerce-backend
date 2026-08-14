'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const source = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const shell = source('css/modal-shell.css');
const media = source('css/modal-media.css');
const hybrid = source('css/modal-product-lot4-hybrid.css');

describe('PDP desktop premium polish', () => {
  test('élargit la coque commerciale sans casser les régions', () => {
    expect(shell).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*296px/);
    expect(hybrid).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(390px,\s*420px\)/);
    expect(hybrid).toMatch(/clamp\(24px,\s*2vw,\s*36px\)/);
  });

  test('donne davantage de présence au media desktop', () => {
    expect(media).toMatch(/max-width:\s*min\(100%,\s*700px\)/);
    expect(media).toMatch(/max-width:\s*640px/);
    expect(media).toMatch(/aspect-ratio:\s*1\s*\/\s*1/);
  });

  test('renforce la hiérarchie titre prix actions', () => {
    expect(shell).toMatch(/\.k-modal-info h2\s*\{[^}]*font-size:\s*20px[^}]*font-weight:\s*600/s);
    expect(shell).toMatch(/\.k-modal-price\s*\{[^}]*font-size:\s*32px[^}]*font-weight:\s*600/s);
    expect(shell).toMatch(/\.k-add-cart-btn\s*\{[\s\S]*?height:\s*48px[\s\S]*?font-size:\s*14px;\s*font-weight:\s*700/s);
    expect(shell).toMatch(/\.k-buy-now-btn\s*\{[\s\S]*?height:\s*48px[\s\S]*?font-size:\s*14px;\s*font-weight:\s*700/s);
  });
});
