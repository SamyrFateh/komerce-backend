'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { paleYellowFills } = require('../helpers/noYellowFill');

test('pricing-simulation.css : aucun fond jaune/crème pâle (fond blanc)', () => {
  expect(paleYellowFills('pricing-simulation.css')).toEqual([]);
});

test('pricing-simulation.css : plancher typographique (aucun texte sous 10 px)', () => {
  expect(require('../helpers/fontFloor').tinyFonts('pricing-simulation.css')).toEqual([]);
});
