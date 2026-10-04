'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const {
  createProvisioningMarket,
  transitionMarketLifecycle,
  ALLOWED_TRANSITIONS,
} = require('../../services/market-lifecycle-service');

describe('market-lifecycle-service', () => {
  test('exports the canonical lifecycle writer surface', () => {
    expect(typeof createProvisioningMarket).toBe('function');
    expect(typeof transitionMarketLifecycle).toBe('function');
    expect(ALLOWED_TRANSITIONS.CLOSED).toEqual([]);
  });
});
