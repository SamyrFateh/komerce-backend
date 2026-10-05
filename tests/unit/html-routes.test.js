'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '..', '..', 'bootstrap', 'html-routes.js'), 'utf8');

test('la fiche Supplier 360 est Canonical et la liste reste Legacy', () => {
  expect(source).toContain("app.get('/admin/suppliers/:supplierId'");
  expect(source).toContain("'/admin/suppliers',");
  const entity = source.indexOf("app.get('/admin/suppliers/:supplierId'");
  const legacy = source.indexOf("'/admin/suppliers',");
  expect(entity).toBeGreaterThan(-1);
  expect(legacy).toBeGreaterThan(entity);
});
