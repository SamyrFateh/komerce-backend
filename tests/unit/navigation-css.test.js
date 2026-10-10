'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { paleYellowFills } = require('../helpers/noYellowFill');

test('navigation.css : aucun fond jaune/crème pâle (fond blanc)', () => {
  expect(paleYellowFills('navigation.css')).toEqual([]);
});
