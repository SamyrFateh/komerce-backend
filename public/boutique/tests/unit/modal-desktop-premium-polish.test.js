'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const source = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const shell = source('css/modal-shell.css');
const media = source('css/modal-media.css');
const hybrid = source('css/modal-product-lot4-hybrid.css');
const density = source('css/modal-desktop-density.css');

describe('PDP desktop premium polish', () => {
  test('Ã©largit la coque commerciale sans casser les rÃ©gions', () => {
    expect(shell).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*296px/);
    expect(hybrid).toMatch(/grid-template-columns:\s*minmax\(0,\s*48%\)\s*minmax\(0,\s*52%\)/);
    expect(density).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(460px,\s*520px\)/);
    expect(hybrid).toMatch(/clamp\(24px,\s*2vw,\s*36px\)/);
  });

  test('donne davantage de présence au media desktop', () => {
    const heroRule = media.match(
      /#k-modal \.k-modal-product-zone \.k-modal-img-wrap\s*\{([^}]*)\}/
    )?.[1] ?? '';

    const carouselRule = media.match(
      /#k-modal \.k-modal-product-zone \.k-modal-carousel\s*\{([^}]*)\}/
    )?.[1] ?? '';

    expect(heroRule).toMatch(/max-width\s*:\s*none/);
    expect(heroRule).toMatch(/align-self\s*:\s*stretch/);

    expect(carouselRule).toMatch(/max-width\s*:\s*none/);
    expect(carouselRule).toMatch(/height\s*:\s*auto/);
    expect(carouselRule).toMatch(/aspect-ratio\s*:\s*4\s*\/\s*3/);
    expect(carouselRule).toMatch(/align-self\s*:\s*start/);
  });
  test('renforce la hiÃ©rarchie titre prix actions', () => {
    expect(shell).toMatch(/\.k-modal-info h2\s*\{[^}]*font-size:\s*20px[^}]*font-weight:\s*600/s);
    expect(shell).toMatch(/\.k-modal-price\s*\{[^}]*font-size:\s*32px[^}]*font-weight:\s*600/s);
    expect(shell).toMatch(/\.k-add-cart-btn\s*\{[\s\S]*?height:\s*48px[\s\S]*?font-size:\s*14px;\s*font-weight:\s*700/s);
    expect(shell).toMatch(/\.k-buy-now-btn\s*\{[\s\S]*?height:\s*48px[\s\S]*?font-size:\s*14px;\s*font-weight:\s*700/s);
  });
});
