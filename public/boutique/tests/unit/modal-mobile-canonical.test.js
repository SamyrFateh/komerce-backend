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
});
