'use strict';
/** @test-kind unit @test-runner jest @test-requires none */

test('markets-essential.css : plancher typographique (aucun texte sous 10 px)', () => {
  expect(require('../helpers/fontFloor').tinyFonts('markets-essential.css')).toEqual([]);
});
