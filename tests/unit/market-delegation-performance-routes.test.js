'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const routeSource = fs.readFileSync(path.join(ROOT, 'routes', 'market-delegation-performance.js'), 'utf8');
const bootstrapSource = fs.readFileSync(path.join(ROOT, 'bootstrap', 'api-routes.js'), 'utf8');

describe('market-delegation performance route', () => {
  test('une seule route, authentifiée, en lecture seule', () => {
    const declarations = routeSource.match(/router\.(get|post|put|patch|delete)\([^\n]+/g) || [];
    expect(declarations).toHaveLength(1);
    expect(declarations[0]).toContain('router.get');
    expect(declarations[0]).toContain('authenticate');
  });

  test('aucune mutation possible — la performance est une projection, jamais une vérité nouvelle', () => {
    expect(routeSource).not.toMatch(/router\.(post|put|patch|delete)/);
  });

  test('le marché vient du :marketCode de la route, jamais du client', () => {
    expect(routeSource).toContain('req.params.marketCode');
    expect(routeSource).not.toMatch(/body\.market_id|body\.marketId|query\.market_id/);
  });

  test('capability-based, jamais un raccourci par rôle', () => {
    expect(routeSource).not.toMatch(/requireRole\(/);
    expect(routeSource).not.toMatch(/req\.user\.role\s*===/);
  });

  test('montée exactement une fois à la racine de composition', () => {
    expect(bootstrapSource).toMatch(/const marketDelegationPerformanceRouter = require\('\.\.\/routes\/market-delegation-performance'\)/);
    const mounts = bootstrapSource.match(/app\.use\('\/api\/market-delegation', marketDelegationPerformanceRouter\)/g) || [];
    expect(mounts).toHaveLength(1);
  });
});
