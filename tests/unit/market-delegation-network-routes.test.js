'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const routeSource = fs.readFileSync(path.join(ROOT, 'routes', 'market-delegation-network.js'), 'utf8');
const bootstrapSource = fs.readFileSync(path.join(ROOT, 'bootstrap', 'api-routes.js'), 'utf8');

describe('market-delegation network routes', () => {
  test('all five network routes are authenticated', () => {
    const routeDeclarations = routeSource.match(/router\.(get|post|put|delete)\([^\n]+/g) || [];
    expect(routeDeclarations).toHaveLength(5);
    expect(routeDeclarations.every(line => line.includes('authenticate'))).toBe(true);
  });

  test('market_id/marketId supplied by client is rejected on mutating routes; marketCode is the only public locator', () => {
    expect(routeSource).toMatch(/MARKET_ID_FORBIDDEN/);
    expect(routeSource).toMatch(/body\.market_id/);
    expect(routeSource).toMatch(/body\.marketId/);
    expect(routeSource).toMatch(/markets\/:marketCode\/network\/relais/);
    expect(routeSource).not.toMatch(/markets\/:marketId\/network/);
  });

  test('network actions are capability based, never user role based', () => {
    expect(routeSource).toContain(`'network.read'`);
    const serviceSource = fs.readFileSync(path.join(ROOT, 'services', 'market-delegation-network-service.js'), 'utf8');
    for (const capability of ['network.create', 'network.update', 'network.suspend']) {
      expect(serviceSource).toContain(`'${capability}'`);
    }
    expect(routeSource).not.toMatch(/requireRole\(/);
    expect(routeSource).not.toMatch(/req\.user\.role\s*===\s*['"]market_operator/);
    expect(serviceSource).not.toMatch(/requireRole\(/);
  });

  test('suspend and activate are distinct explicit endpoints, never a generic DELETE', () => {
    expect(routeSource).toMatch(/\/network\/relais\/:relaisId\/suspend/);
    expect(routeSource).toMatch(/\/network\/relais\/:relaisId\/activate/);
    expect(routeSource).not.toMatch(/router\.delete/);
  });

  test('API is mounted exactly once at the composition root, alongside the team router', () => {
    expect(bootstrapSource).toMatch(/const marketDelegationNetworkRouter = require\('\.\.\/routes\/market-delegation-network'\)/);
    const mounts = bootstrapSource.match(/app\.use\('\/api\/market-delegation', marketDelegationNetworkRouter\)/g) || [];
    expect(mounts).toHaveLength(1);
  });
});
