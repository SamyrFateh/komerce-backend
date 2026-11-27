'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'public', 'dashboards', 'canonical', 'js', 'app.js');

test('Catalogue central indépendant du contexte ; lentille marché exige le contexte serveur', () => {
  const source = fs.readFileSync(APP, 'utf8');
  expect(source).toContain('const surface = surfaceForPath(global.location.pathname);');
  expect(source).toContain('surface === SURFACES.CATALOG_WORKSPACE && !isMarketCatalogLens(user)');
  expect(source).toMatch(/const adminContext = [^\n]*CATALOG_WORKSPACE[^\n]*\n\s*\? null\s*:\s*await requireAdminContext\(\)/);
  expect(source).toContain("return user?.role === 'market_operator' || params.has('market') || params.get('lens') === 'market';");
  expect(source).toMatch(/if \(isMarketCatalogLens\(user\)\) \{[\s\S]{0,450}return global\.KomerceMarketCatalog\.mount/);
  const routes = fs.readFileSync(path.join(ROOT, 'routes/admin-catalog-workspace.js'), 'utf8');
  expect(routes).toContain("const guard = [authenticate, requireRole(['admin']), requireCatalogGlobalAuthority];");
  expect(source).toContain('if (surface === SURFACES.CATALOG_WORKSPACE) return renderCatalogWorkspace(root, user, adminContext);');
});
