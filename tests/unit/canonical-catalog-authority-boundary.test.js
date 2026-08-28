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

test('Catalogue peut démarrer sans dépendre du Dashboard AdminContext', () => {
  const source = fs.readFileSync(APP, 'utf8');
  expect(source).toContain('const surface = surfaceForPath(global.location.pathname);');
  expect(source).toMatch(/surface === SURFACES\.CATALOG_WORKSPACE[\s\S]{0,320}\? null[\s\S]{0,100}: await requireAdminContext\(\)/);
  expect(source).toContain('if (surface === SURFACES.CATALOG_WORKSPACE) return renderCatalogWorkspace(root, user, adminContext);');
});
