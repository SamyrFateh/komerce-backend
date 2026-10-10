'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { paleYellowFills } = require('../helpers/noYellowFill');

test('base.css : aucun fond jaune/crème pâle (fond blanc)', () => {
  expect(paleYellowFills('base.css')).toEqual([]);
});

test('base.css : plancher typographique (aucun texte sous 10 px)', () => {
  expect(require('../helpers/fontFloor').tinyFonts('base.css')).toEqual([]);
});
