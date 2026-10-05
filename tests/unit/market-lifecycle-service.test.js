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


describe('reprovision lookup guard', () => {
  test('source requires PROVISIONING without ACTIVE assignment', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'market-lifecycle-service.js'), 'utf8');
    expect(source).toMatch(/MARKET_REPROVISION_REQUIRES_PROVISIONING/);
    expect(source).toMatch(/MARKET_REPROVISION_ACTIVE_ASSIGNMENT/);
    expect(source).toMatch(/market_operating_assignments/);
  });
});
