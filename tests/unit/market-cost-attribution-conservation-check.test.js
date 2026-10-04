'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  pool: { end: jest.fn().mockResolvedValue() },
}));

const {
  main,
  parseEventIds,
} = require('../../scripts/market-cost-attribution-conservation-check');

describe('market-cost-attribution-conservation-check', () => {
  test('exports the canonical CLI surface', () => {
    expect(typeof main).toBe('function');
    expect(typeof parseEventIds).toBe('function');
  });

  test('parses repeated event ids without mutation', () => {
    expect(parseEventIds(['--event-id', 'a', '--event-id', 'b'])).toEqual(['a', 'b']);
  });
});
