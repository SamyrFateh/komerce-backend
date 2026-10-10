'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { paleYellowFills } = require('../helpers/noYellowFill');

test('pricing-simulation.css : aucun fond jaune/crème pâle (fond blanc)', () => {
  expect(paleYellowFills('pricing-simulation.css')).toEqual([]);
});
