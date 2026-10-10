'use strict';
/** @test-kind unit @test-runner jest @test-requires none */

test('pricing-workspace-economic-v3.css : plancher typographique (aucun texte sous 10 px)', () => {
  expect(require('../helpers/fontFloor').tinyFonts('pricing-workspace-economic-v3.css')).toEqual([]);
});
