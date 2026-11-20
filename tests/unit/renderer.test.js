'use strict';
/** @test-kind unit @test-runner jest @test-requires none */

test('renderer.css : plancher typographique (aucun texte sous 10 px)', () => {
  expect(require('../helpers/fontFloor').tinyFonts('renderer.css')).toEqual([]);
});

test('vue consolidée : état de lecture distinct des ateliers actionnels et responsive', () => {
  const fs = require('fs'), path = require('path');
  const css = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/css/renderer.css'), 'utf8');
  expect(css).toContain('.kmc-market-global-overview {');
  expect(css).toContain('[data-market-global-body] { min-width: 0; }');
  expect(css).toContain('width: min(100% - 24px, 1440px)');
});
