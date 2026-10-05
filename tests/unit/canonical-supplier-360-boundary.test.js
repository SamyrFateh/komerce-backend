'use strict';
/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

test('Supplier 360 est Canonical mais la liste fournisseurs reste Legacy', () => {
  const htmlRoutes = fs.readFileSync(path.join(ROOT, 'bootstrap', 'html-routes.js'), 'utf8');
  expect(htmlRoutes).toContain("app.get('/admin/suppliers/:supplierId'");
  expect(htmlRoutes).toContain("'/admin/suppliers',");
  expect(htmlRoutes).toContain('sendCanonicalAdmin(res)');
  expect(htmlRoutes).toContain('sendLegacyAdmin(res)');
});

test('Supplier 360 ne référence aucun secret côté UI', () => {
  const source = fs.readFileSync(path.join(ROOT, 'public', 'dashboards', 'canonical', 'js', 'supplier-360.js'), 'utf8');
  expect(source).toContain('has_api_key');
  expect(source).toContain('has_api_secret');
  expect(source).not.toContain('api_key_enc');
  expect(source).not.toContain('api_secret_enc');
});
