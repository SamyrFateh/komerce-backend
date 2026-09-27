'use strict';

const {
  parseArgs,
  selectSuites,
} = require('../../scripts/run-e2e-feature-tests');

const suites = [
  { file: 'tests/e2e-api/catalog.a.e2e.test.js', feature: 'catalog' },
  { file: 'tests/e2e-api/orders.a.e2e.test.js', feature: 'orders' },
  { file: 'tests/e2e-api/purchasing.a.e2e.test.js', feature: 'purchasing' },
  { file: 'tests/e2e-api/sourcing.a.e2e.test.js', feature: 'sourcing' },
];

describe('Feature-first E2E multi-feature selection', () => {
  test('parse --features de-duplicates and sorts', () => {
    expect(parseArgs(['node', 'runner', '--features=sourcing,catalog,sourcing']))
      .toEqual({ feature: null, features: ['catalog', 'sourcing'], lot: null });
  });

  test('rejects mixed selectors', () => {
    expect(() => parseArgs(['node', 'runner', '--feature=catalog', '--lot=1']))
      .toThrow('Utiliser un seul sélecteur');
  });

  test('selects only requested features', () => {
    expect(selectSuites(suites, {
      feature: null,
      features: ['catalog', 'sourcing'],
      lot: null,
    })).toEqual([
      suites[0],
      suites[3],
    ]);
  });

  test('fails if a requested feature has no E2E suite', () => {
    expect(() => selectSuites(suites, {
      feature: null,
      features: ['catalog', 'unknown'],
      lot: null,
    })).toThrow('Aucun E2E pour : unknown');
  });
});
