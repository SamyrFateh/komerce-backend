'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

describe('market reprovisioning contract', () => {
  test('reuses the same provisioning composition instead of a parallel writer', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'services', 'market-provisioning-service.js'),
      'utf8'
    );
    expect(source).toMatch(/async function configureProvisioningMarket/);
    expect(source).toMatch(/async function provisionMarket/);
    expect(source).toMatch(/async function reprovisionMarket/);
    expect(source.match(/return configureProvisioningMarket\(executor/g)).toHaveLength(2);
    expect(source).toMatch(/loadProvisioningMarket/);
  });

  test('reprovision lookup only accepts inactive PROVISIONING without ACTIVE assignment', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'services', 'market-lifecycle-service.js'),
      'utf8'
    );
    expect(source).toMatch(/MARKET_REPROVISION_REQUIRES_PROVISIONING/);
    expect(source).toMatch(/MARKET_REPROVISION_ACTIVE_ASSIGNMENT/);
    expect(source).toMatch(/lifecycle_status !== 'PROVISIONING'/);
    expect(source).toMatch(/status='ACTIVE'/);
  });

  test('admin surface exposes an explicit reprovision endpoint', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'routes', 'admin-market-control-plane.js'),
      'utf8'
    );
    expect(source).toMatch(/router\.post\('\/:marketCode\/reprovision'/);
    expect(source).toMatch(/reprovisionMarket/);
  });
});
