'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { paleYellowFills } = require('../helpers/noYellowFill');

test('catalog-control-tower.css : aucun fond jaune/crème pâle (fond blanc)', () => {
  expect(paleYellowFills('catalog-control-tower.css')).toEqual([]);
});
