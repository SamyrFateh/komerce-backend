'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { paleYellowFills } = require('../helpers/noYellowFill');

test('demo-order-flow.css : aucun fond jaune/crème pâle (fond blanc)', () => {
  expect(paleYellowFills('demo-order-flow.css')).toEqual([]);
});
