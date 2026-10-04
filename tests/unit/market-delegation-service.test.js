'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const delegation = require('../../services/market-delegation-service');

describe('market-delegation-service — provisioning writers', () => {
  test('exposes delegation-owned writers for central referent and amount limits', () => {
    expect(typeof delegation.setCentralReferent).toBe('function');
    expect(typeof delegation.setCeilingAmountLimits).toBe('function');
  });
});
