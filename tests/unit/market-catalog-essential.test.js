'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { paleYellowFills } = require('../helpers/noYellowFill');

test('market-catalog-essential.css : aucun fond jaune/crème pâle (fond blanc)', () => {
  expect(paleYellowFills('market-catalog-essential.css')).toEqual([]);
});
