'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '..', '..', 'bootstrap', 'api-routes.js'), 'utf8');

test('API bootstrap monte Supplier 360 dans le namespace entities', () => {
  expect(source).toContain("require('../routes/admin-supplier-360')");
  expect(source).toContain("app.use('/api/admin/entities',    adminSupplier360Router)");
});


test('API bootstrap monte les routers dashboard par identifiant pour le route registry', () => {
  expect(source).toContain("const adminDashboardMarketRouter = require('../routes/admin-dashboard-market')");
  expect(source).toContain("const adminDashboardLegacyRouter = require('../routes/admin-dashboard')");
  expect(source).toContain("app.use('/api/admin/dashboard',   adminDashboardMarketRouter)");
  expect(source).toContain("app.use('/api/admin/dashboard',   adminDashboardLegacyRouter)");
  expect(source).not.toContain("app.use('/api/admin/dashboard',   require('../routes/admin-dashboard-market'))");
});
