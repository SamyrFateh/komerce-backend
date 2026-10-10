'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { paleYellowFills } = require('../helpers/noYellowFill');

test('market-catalog-essential.css : aucun fond jaune/crème pâle (fond blanc)', () => {
  expect(paleYellowFills('market-catalog-essential.css')).toEqual([]);
});

test('market-catalog-essential.css : plancher typographique (aucun texte sous 10 px)', () => {
  expect(require('../helpers/fontFloor').tinyFonts('market-catalog-essential.css')).toEqual([]);
});
