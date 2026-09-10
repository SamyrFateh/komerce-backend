'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const routeSource = fs.readFileSync(path.join(ROOT, 'routes', 'market-delegation-structure-event.js'), 'utf8');
const bootstrapSource = fs.readFileSync(path.join(ROOT, 'bootstrap', 'api-routes.js'), 'utf8');

describe('market-delegation structure-event routes', () => {
  test('both routes are authenticated', () => {
    const routeDeclarations = routeSource.match(/router\.(get|post|put|delete)\([^\n]+/g) || [];
    expect(routeDeclarations).toHaveLength(2);
    expect(routeDeclarations.every(line => line.includes('authenticate'))).toBe(true);
  });

  test('write is capability-based (structure.event.record), read reuses pricing.read — never user role', () => {
    expect(routeSource).toContain('recordStructureEvent');
    expect(routeSource).toContain('listStructureEvents');
    expect(routeSource).not.toMatch(/requireRole\(/);
    expect(routeSource).not.toMatch(/req\.user\.role\s*===\s*['"]market_operator/);
  });

  test('no DELETE, no PUT — append-only, corrections go through recordStructureEvent as new events', () => {
    expect(routeSource).not.toMatch(/router\.delete/);
    expect(routeSource).not.toMatch(/router\.put/);
  });

  test('API is mounted exactly once at the composition root', () => {
    expect(bootstrapSource).toMatch(/const marketDelegationStructureEventRouter = require\('\.\.\/routes\/market-delegation-structure-event'\)/);
    const mounts = bootstrapSource.match(/app\.use\('\/api\/market-delegation', marketDelegationStructureEventRouter\)/g) || [];
    expect(mounts).toHaveLength(1);
  });
});
