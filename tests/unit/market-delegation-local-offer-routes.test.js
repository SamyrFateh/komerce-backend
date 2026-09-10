'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const routeSource = fs.readFileSync(path.join(ROOT, 'routes', 'market-delegation-local-offer.js'), 'utf8');
const bootstrapSource = fs.readFileSync(path.join(ROOT, 'bootstrap', 'api-routes.js'), 'utf8');

describe('market-delegation local-offer routes', () => {
  test('all four routes are authenticated', () => {
    const routeDeclarations = routeSource.match(/router\.(get|post|put|delete)\([^\n]+/g) || [];
    expect(routeDeclarations).toHaveLength(4);
    expect(routeDeclarations.every(line => line.includes('authenticate'))).toBe(true);
  });

  test('market_id/marketId supplied by client is rejected on mutating routes; marketCode is the only public locator', () => {
    expect(routeSource).toMatch(/MARKET_ID_FORBIDDEN/);
    expect(routeSource).toMatch(/body\.market_id/);
    expect(routeSource).toMatch(/body\.marketId/);
    expect(routeSource).toMatch(/markets\/:marketCode\/local-offer\/services/);
    expect(routeSource).toMatch(/markets\/:marketCode\/local-offer\/physical-offers/);
    expect(routeSource).not.toMatch(/markets\/:marketId\/local-offer/);
  });

  test('local offer exposure is capability based, never user role based', () => {
    expect(routeSource).toContain(`'local_offer.manage'`);
    expect(routeSource).not.toMatch(/requireRole\(/);
    expect(routeSource).not.toMatch(/req\.user\.role\s*===\s*['"]market_operator/);
  });

  test('no DELETE endpoint — exposure toggles, never removes a decision', () => {
    expect(routeSource).not.toMatch(/router\.delete/);
  });

  test('API is mounted exactly once at the composition root', () => {
    expect(bootstrapSource).toMatch(/const marketDelegationLocalOfferRouter = require\('\.\.\/routes\/market-delegation-local-offer'\)/);
    const mounts = bootstrapSource.match(/app\.use\('\/api\/market-delegation', marketDelegationLocalOfferRouter\)/g) || [];
    expect(mounts).toHaveLength(1);
  });
});
