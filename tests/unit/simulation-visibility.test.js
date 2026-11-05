'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { wantsSimulation, simulationClause } = require('../../services/simulation-visibility');

test('admin seul peut inclure la recette, uniquement avec 1/true', () => {
  expect(wantsSimulation({ role: 'admin' }, { include_simulation: '1' })).toBe(true);
  expect(wantsSimulation({ role: 'admin' }, { include_simulation: 'true' })).toBe(true);
  expect(wantsSimulation({ role: 'admin' }, {})).toBe(false);
  expect(wantsSimulation({ role: 'admin' }, { include_simulation: '0' })).toBe(false);
  for (const role of ['agent_hub', 'agent_relais', 'market_operator', 'finance', 'sourcing']) {
    expect(wantsSimulation({ role }, { include_simulation: '1' })).toBe(false);
  }
  expect(wantsSimulation(null, { include_simulation: '1' })).toBe(false);
});

test('clause unique : exclut par défaut, neutre si inclus', () => {
  expect(simulationClause('o', false)).toBe('o.simulation_scope IS NULL');
  expect(simulationClause('o', true)).toBe('TRUE');
});
