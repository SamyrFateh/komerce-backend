'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { paleYellowFills } = require('../helpers/noYellowFill');

test('operations-control-board-v1.css : aucun fond jaune/crème pâle (fond blanc)', () => {
  expect(paleYellowFills('operations-control-board-v1.css')).toEqual([]);
});
