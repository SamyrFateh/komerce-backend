'use strict';
/** @test-kind unit @test-runner jest @test-requires none */

test('market-team.css : plancher typographique (aucun texte sous 10 px)', () => {
  expect(require('../helpers/fontFloor').tinyFonts('market-team.css')).toEqual([]);
});
