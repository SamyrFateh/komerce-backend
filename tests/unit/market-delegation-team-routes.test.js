'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const routeSource = fs.readFileSync(path.join(ROOT, 'routes', 'market-delegation-team.js'), 'utf8');
const bootstrapSource = fs.readFileSync(path.join(ROOT, 'bootstrap', 'api-routes.js'), 'utf8');
const legacyMiddleware = fs.readFileSync(path.join(ROOT, 'middleware', 'require-market-scope.js'), 'utf8');

describe('market-delegation team routes', () => {
  test('all six LOT 1A routes are authenticated', () => {
    const routeDeclarations = routeSource.match(/router\.(get|post|put|delete)\([^\n]+/g) || [];
    expect(routeDeclarations).toHaveLength(6);
    expect(routeDeclarations.every(line => line.includes('authenticate'))).toBe(true);
  });

  test('market_id supplied by client is rejected and marketCode is the public locator', () => {
    expect(routeSource).toMatch(/MARKET_ID_FORBIDDEN/);
    expect(routeSource).toMatch(/body\.market_id/);
    expect(routeSource).toMatch(/body\.marketId/);
    expect(routeSource).toMatch(/markets\/:marketCode\/team/);
    expect(routeSource).not.toMatch(/markets\/:marketId\/team/);
  });

  test('team actions are capability based, not user role based', () => {
    for (const capability of ['team.read', 'team.invite', 'team.grant', 'team.revoke']) {
      expect(routeSource).toContain(`'${capability}'`);
    }
    expect(routeSource).not.toMatch(/requireRole\(/);
    expect(routeSource).not.toMatch(/req\.user\.role\s*===\s*['"]market_operator/);
  });

  test('API is mounted once at the composition root', () => {
    expect(bootstrapSource).toMatch(/const marketDelegationTeamRouter = require\('\.\.\/routes\/market-delegation-team'\)/);
    const mounts = bootstrapSource.match(/app\.use\('\/api\/market-delegation', marketDelegationTeamRouter\)/g) || [];
    expect(mounts).toHaveLength(1);
  });

  test('legacy require-market-scope middleware remains untouched by LOT 1A', () => {
    expect(legacyMiddleware).not.toMatch(/membership_capabilities/);
    expect(legacyMiddleware).not.toMatch(/market_team_invitations/);
    expect(legacyMiddleware).not.toMatch(/market_operating_assignments/);
  });
});
