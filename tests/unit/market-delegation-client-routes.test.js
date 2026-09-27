'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const routeSource = fs.readFileSync(path.join(ROOT, 'routes', 'market-delegation-client.js'), 'utf8');
const bootstrapSource = fs.readFileSync(path.join(ROOT, 'bootstrap', 'api-routes.js'), 'utf8');

describe('market-delegation client routes', () => {
  test('both routes are authenticated and capability-gated', () => {
    const routeBlocks = routeSource.match(/router\.get\(\s*\n(?:.|\n)*?\n\s*\);/g) || [];
    expect(routeBlocks).toHaveLength(2);
    expect(routeBlocks.every(block => block.includes('authenticate'))).toBe(true);
    expect(routeBlocks.every(block => block.includes('requireMarketDelegatedCapability(CAPABILITY)'))).toBe(true);
  });

  test('capability is exactly client.read, never role-based', () => {
    expect(routeSource).toContain(`'client.read'`);
    expect(routeSource).not.toMatch(/requireRole\(/);
    expect(routeSource).not.toMatch(/req\.user\.role\s*===\s*['"]market_operator/);
  });

  test('market_id/marketId supplied by the client is rejected; marketCode is the only public locator', () => {
    expect(routeSource).toMatch(/client_market_identity_forbidden/);
    expect(routeSource).toMatch(/hasOwnProperty\.call\(query, 'market_id'\)/);
    expect(routeSource).toMatch(/hasOwnProperty\.call\(query, 'marketId'\)/);
    expect(routeSource).toMatch(/markets\/:marketCode\/clients/);
    expect(routeSource).not.toMatch(/markets\/:marketId\/clients/);
  });

  test('market_id used by handlers comes only from req.marketDelegatedCapability', () => {
    expect(routeSource).toMatch(/req\.marketDelegatedCapability/);
    expect(routeSource).not.toMatch(/req\.query\.market_id/);
    expect(routeSource).not.toMatch(/req\.body\.market_id/);
  });

  test('client 360 in market mode never includes account security facets', () => {
    expect(routeSource).toMatch(/includeSecurity:\s*false/);
    expect(routeSource).not.toMatch(/includeSecurity:\s*true/);
  });

  test('no DELETE/POST/PUT endpoint — read-only surface', () => {
    expect(routeSource).not.toMatch(/router\.delete/);
    expect(routeSource).not.toMatch(/router\.post/);
    expect(routeSource).not.toMatch(/router\.put/);
  });

  test('API is mounted exactly once at the composition root', () => {
    expect(bootstrapSource).toMatch(/const marketDelegationClientRouter = require\('\.\.\/routes\/market-delegation-client'\)/);
    const mounts = bootstrapSource.match(/app\.use\('\/api\/market-delegation', marketDelegationClientRouter\)/g) || [];
    expect(mounts).toHaveLength(1);
  });
});
