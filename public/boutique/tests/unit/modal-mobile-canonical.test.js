'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');

describe('modal-mobile-canonical.css - suggestion responsibilities', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '../../css/modal-mobile-canonical.css'),
    'utf8'
  );
  const productCss = fs.readFileSync(
    path.join(__dirname, '../../css/modal-product.css'),
    'utf8'
  );

  test('does not own the visual suggestion button styles', () => {
    expect(css).not.toMatch(
      /(^|\n)\s*#k-modal\s+\.k-sug-add(?:[:\s,{])/m
    );
  });

  test('keeps the vertical price then actions layout', () => {
    expect(css).toMatch(
      /#k-modal\s+\.k-sug-card-bottom\s*\{[^}]*flex-direction:\s*column[^}]*align-items:\s*stretch/s
    );

    expect(css).toMatch(
      /#k-modal\s+\.k-sug-card-price\s*\{[^}]*white-space:\s*nowrap/s
    );

    expect(css).toMatch(
      /#k-modal\s+\.k-sug-card-actions\s*\{[^}]*justify-content:\s*flex-end/s
    );
  });

  test('aligns suggestion actions at the bottom of every card', () => {
    expect(css).toMatch(
      /#k-modal\s+\.k-sug-grid\s+\.k-sug-card\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*align-self:\s*stretch/s
    );

    expect(css).toMatch(
      /#k-modal\s+\.k-sug-card-bottom\s*\{[^}]*margin-top:\s*auto/s
    );
  });

  test('gives mobile suggestions enough width to keep product names readable', () => {
    expect(css).toMatch(
      /#k-modal\s+\.k-sug-grid\s+\.k-sug-card\s*\{[^}]*flex:\s*0\s+0\s+132px[^}]*width:\s*132px/s
    );
  });

  test('keeps reassurance left-aligned and visible without duplicating stock', () => {
    expect(css).toMatch(
      /#k-modal\s+\.k-modal-trust\s*\{[^}]*min-height:\s*34px[^}]*overflow:\s*visible/s
    );
    expect(css).toMatch(
      /#k-modal\s+\.k-modal-trust-item:nth-child\(3\)\s*\{[^}]*display:\s*none/s
    );
    expect(productCss).toMatch(
      /#k-modal\s+\.k-modal-trust\s*\{[^}]*justify-content:\s*flex-start[^}]*gap:\s*clamp\(10px,\s*4vw,\s*18px\)[^}]*padding:\s*5px 0/s
    );
  });

  test('adds only the agreed 8px of breathing room to mobile product identity', () => {
    expect(css).toMatch(
      /#k-modal\s+\.k-modal-sku\s*\{[^}]*margin-top:\s*2px/s
    );
    expect(css).toMatch(
      /#k-modal\s+\.k-modal-price-row\s*\{[^}]*margin-top:\s*4px/s
    );
    expect(productCss).toMatch(
      /#k-modal\s+\.k-modal-trust\s*\{[^}]*padding:\s*5px 0[^}]*margin-top:\s*6px/s
    );
  });

  test('V4 mobile — galerie 16:9, favori 44px overlay, détails hiérarchisés', () => {
    expect(css).toMatch(/aspect-ratio:\s*16 \/ 9/);
    expect(css).toMatch(/#k-modal \.k-modal-img-wrap > \.k-modal-fav-btn\s*\{[^}]*position:\s*absolute[^}]*width:\s*44px[^}]*height:\s*44px/s);
    expect(css).toMatch(/\.k-mdm-details-title\s*\{[^}]*font-size:\s*19px/s);
  });

  test('uses compact color, size and delivery controls below the hero', () => {
    expect(css).toMatch(
      /#k-modal\s+\.k-sku-color-dot\s*\{[^}]*width:\s*30px[^}]*height:\s*30px/s
    );
    expect(css).toMatch(
      /#k-modal\s+\.k-vp\s*\{[^}]*min-height:\s*34px[^}]*min-width:\s*48px/s
    );
    expect(css).toMatch(
      /\.k-mdm-chip--delivery\s*\{[^}]*min-height:\s*40px/s
    );
  });

  test('aligns the mobile stepper and purchase CTA on the same 44px rail', () => {
    expect(css).toMatch(
      /#k-modal\s+\.k-modal-actions\s*\{[^}]*grid-template-columns:\s*minmax\(118px,\s*\.9fr\)[^}]*gap:\s*8px/s
    );
    expect(css).toMatch(
      /#k-modal\s+\.k-qty,[^}]*#k-modal\s+\.k-modal-actions\s+\.k-buy-now-btn\s*\{[^}]*height:\s*44px[^}]*border-radius:\s*14px/s
    );
  });
});
