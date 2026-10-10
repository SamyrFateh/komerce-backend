'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { paleYellowFills } = require('../helpers/noYellowFill');

test('base.css : aucun fond jaune/crème pâle (fond blanc)', () => {
  expect(paleYellowFills('base.css')).toEqual([]);
});
