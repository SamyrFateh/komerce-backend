'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { paleYellowFills } = require('../helpers/noYellowFill');

test('komerce-visual-canon-v1.css : aucun fond jaune/crème pâle (fond blanc)', () => {
  expect(paleYellowFills('komerce-visual-canon-v1.css')).toEqual([]);
});
