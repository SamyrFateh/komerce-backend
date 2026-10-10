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

test('monte /api/admin/providers sur le routeur de capacités certifiées', () => {
  expect(source).toContain("require('../routes/admin-providers-capabilities')");
  expect(source).toContain("app.use('/api/admin/providers',   adminProvidersCapabilitiesRouter)");
});

test('monte /api/agent/action-center (Action Center agent borné par rôle et périmètre)', () => {
  expect(source).toContain("require('../routes/agent-action-center')");
  expect(source).toContain("app.use('/api/agent/action-center', agentActionCenterRouter)");
});

test('monte /api/market-delegation/.../cost-statement (relevé de coûts du marché, lecture seule)', () => {
  expect(source).toContain("require('../routes/market-delegation-cost-statement')");
  expect(source).toContain("app.use('/api/market-delegation', marketDelegationCostStatementRouter)");
});
