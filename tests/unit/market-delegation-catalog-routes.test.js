'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const routeSource = fs.readFileSync(path.join(ROOT, 'routes', 'market-delegation-catalog.js'), 'utf8');
const bootstrapSource = fs.readFileSync(path.join(ROOT, 'bootstrap', 'api-routes.js'), 'utf8');

describe('market-delegation catalog routes', () => {
  test('both routes are authenticated', () => {
    const routeDeclarations = routeSource.match(/router\.(get|post|put|delete)\([^\n]+/g) || [];
    expect(routeDeclarations).toHaveLength(2);
    expect(routeDeclarations.every(line => line.includes('authenticate'))).toBe(true);
  });

  test('market_id/marketId supplied by client is rejected; marketCode is the only public locator', () => {
    expect(routeSource).toMatch(/MARKET_ID_FORBIDDEN/);
    expect(routeSource).toMatch(/body\.market_id/);
    expect(routeSource).toMatch(/body\.marketId/);
    expect(routeSource).toMatch(/markets\/:marketCode\/catalog\/exposure/);
    expect(routeSource).not.toMatch(/markets\/:marketId\/catalog/);
  });

  test('catalog exposure is capability based, never user role based', () => {
    expect(routeSource).toContain(`'catalog.expose'`);
    expect(routeSource).not.toMatch(/requireRole\(/);
    expect(routeSource).not.toMatch(/req\.user\.role\s*===\s*['"]market_operator/);
  });

  test('no DELETE endpoint — exposure toggles, never removes a decision', () => {
    expect(routeSource).not.toMatch(/router\.delete/);
  });

  test('API is mounted exactly once at the composition root', () => {
    expect(bootstrapSource).toMatch(/const marketDelegationCatalogRouter = require\('\.\.\/routes\/market-delegation-catalog'\)/);
    const mounts = bootstrapSource.match(/app\.use\('\/api\/market-delegation', marketDelegationCatalogRouter\)/g) || [];
    expect(mounts).toHaveLength(1);
  });
});
