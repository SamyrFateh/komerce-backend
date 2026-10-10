'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { paleYellowFills } = require('../helpers/noYellowFill');

test('demo-order-flow.css : aucun fond jaune/crème pâle (fond blanc)', () => {
  expect(paleYellowFills('demo-order-flow.css')).toEqual([]);
});

test('demo-order-flow.css : plancher typographique (aucun texte sous 10 px)', () => {
  expect(require('../helpers/fontFloor').tinyFonts('demo-order-flow.css')).toEqual([]);
});
