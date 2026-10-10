'use strict';
/** @test-kind unit @test-runner jest @test-requires none */

test('decision-controls.css : plancher typographique (aucun texte sous 10 px)', () => {
  expect(require('../helpers/fontFloor').tinyFonts('decision-controls.css')).toEqual([]);
});
