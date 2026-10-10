'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { paleYellowFills } = require('../helpers/noYellowFill');

test('action-center-visual.css : aucun fond jaune/crème pâle (fond blanc)', () => {
  expect(paleYellowFills('action-center-visual.css')).toEqual([]);
});

test('action-center-visual.css : plancher typographique (aucun texte sous 10 px)', () => {
  expect(require('../helpers/fontFloor').tinyFonts('action-center-visual.css')).toEqual([]);
});
