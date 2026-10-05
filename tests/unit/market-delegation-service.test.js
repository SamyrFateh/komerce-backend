'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const delegation = require('../../services/market-delegation-service');

describe('market-delegation-service — provisioning writers', () => {
  test('exposes delegation-owned writers for central referent and amount limits', () => {
    expect(typeof delegation.setCentralReferent).toBe('function');
    expect(typeof delegation.setCeilingAmountLimits).toBe('function');
  });
});


test('explicit member limits are part of the grant writer contract', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'market-delegation-service.js'), 'utf8');
  expect(source).toMatch(/capabilityLimits = \{\}/);
  expect(source).toMatch(/membership_capabilities \(membership_id, capability, granted_by, limit_amount\)/);
});
