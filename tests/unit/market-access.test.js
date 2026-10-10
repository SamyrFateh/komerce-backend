'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { paleYellowFills } = require('../helpers/noYellowFill');

test('market-access.css : aucun fond jaune/crème pâle (fond blanc)', () => {
  expect(paleYellowFills('market-access.css')).toEqual([]);
});

test('market-access.css : plancher typographique (aucun texte sous 10 px)', () => {
  expect(require('../helpers/fontFloor').tinyFonts('market-access.css')).toEqual([]);
});
