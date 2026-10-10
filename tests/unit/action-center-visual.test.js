'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { paleYellowFills } = require('../helpers/noYellowFill');

test('action-center-visual.css : aucun fond jaune/crème pâle (fond blanc)', () => {
  expect(paleYellowFills('action-center-visual.css')).toEqual([]);
});
