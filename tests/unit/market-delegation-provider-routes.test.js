'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const routeSource = fs.readFileSync(path.join(ROOT, 'routes', 'market-delegation-provider.js'), 'utf8');
const bootstrapSource = fs.readFileSync(path.join(ROOT, 'bootstrap', 'api-routes.js'), 'utf8');

describe('market-delegation provider routes', () => {
  test('all five provider routes are authenticated', () => {
    const routeDeclarations = routeSource.match(/router\.(get|post|put|delete)\([^\n]+/g) || [];
    expect(routeDeclarations).toHaveLength(5);
    expect(routeDeclarations.every(line => line.includes('authenticate'))).toBe(true);
  });

  test('market_id/marketId supplied by client is rejected on every mutating route; marketCode is the only public locator', () => {
    expect(routeSource).toMatch(/MARKET_ID_FORBIDDEN/);
    expect(routeSource).toMatch(/body\.market_id/);
    expect(routeSource).toMatch(/body\.marketId/);
    expect(routeSource).toMatch(/markets\/:marketCode\/network\/providers/);
    expect(routeSource).not.toMatch(/markets\/:marketId\/network/);
    const rejectCalls = routeSource.match(/rejectMarketId\(req\.body\)/g) || [];
    expect(rejectCalls).toHaveLength(4);
  });

  test('name et phone invalides sont refusés comme erreur client 400, pas transformés en 500 générique', () => {
    expect(routeSource).toContain('NETWORK_PROVIDER_FIELD_REQUIRED');
    expect(routeSource).toMatch(/error\.status = 400/);
    expect(routeSource).toMatch(/requiredProviderText\(body\.name, 'name'\)/);
    expect(routeSource).toMatch(/requiredProviderText\(body\.phone, 'phone'\)/);
  });

  test('provider actions are capability based, never user role based', () => {
    expect(routeSource).toContain(`'provider.manage'`);
    expect(routeSource).not.toMatch(/requireRole\(/);
    expect(routeSource).not.toMatch(/req\.user\.role\s*===\s*['"]market_operator/);
  });

  test('suspend and activate are distinct explicit endpoints, never a generic DELETE', () => {
    expect(routeSource).toMatch(/\/network\/providers\/:providerId\/suspend/);
    expect(routeSource).toMatch(/\/network\/providers\/:providerId\/activate/);
    expect(routeSource).not.toMatch(/router\.delete/);
  });

  test('API is mounted exactly once at the composition root, alongside team and network routers', () => {
    expect(bootstrapSource).toMatch(/const marketDelegationProviderRouter = require\('\.\.\/routes\/market-delegation-provider'\)/);
    const mounts = bootstrapSource.match(/app\.use\('\/api\/market-delegation', marketDelegationProviderRouter\)/g) || [];
    expect(mounts).toHaveLength(1);
  });
});
