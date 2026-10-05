'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'admin-supplier-360.js'), 'utf8');

test('Supplier 360 est read-only et admin-only', () => {
  expect(source).toContain("router.get('/suppliers/:supplierId'");
  expect(source).toContain("requireRole(['admin'])");
  expect(source).toContain('supplier360.resolveSupplier');
  expect(source).toContain('supplier360.loadSupplier360');
  expect(source).not.toMatch(/router\.(post|put|patch|delete)\(/);
});
