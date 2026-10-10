'use strict';
/** @test-kind unit @test-runner jest @test-requires none */

test('entity-360.css : plancher typographique (aucun texte sous 10 px)', () => {
  expect(require('../helpers/fontFloor').tinyFonts('entity-360.css')).toEqual([]);
});
