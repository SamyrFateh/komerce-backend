'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { paleYellowFills } = require('../helpers/noYellowFill');

test('catalog-control-tower.css : aucun fond jaune/crème pâle (fond blanc)', () => {
  expect(paleYellowFills('catalog-control-tower.css')).toEqual([]);
});

test('catalog-control-tower.css : plancher typographique (aucun texte sous 10 px)', () => {
  expect(require('../helpers/fontFloor').tinyFonts('catalog-control-tower.css')).toEqual([]);
});
