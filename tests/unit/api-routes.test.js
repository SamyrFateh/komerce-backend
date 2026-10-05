'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '..', '..', 'bootstrap', 'api-routes.js'), 'utf8');

test('API bootstrap monte Supplier 360 dans le namespace entities', () => {
  expect(source).toContain("require('../routes/admin-supplier-360')");
  expect(source).toContain("app.use('/api/admin/entities',    adminSupplier360Router)");
});
