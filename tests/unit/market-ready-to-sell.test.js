'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { paleYellowFills } = require('../helpers/noYellowFill');

test('market-ready-to-sell.css : aucun fond jaune/crème pâle (fond blanc)', () => {
  expect(paleYellowFills('market-ready-to-sell.css')).toEqual([]);
});
