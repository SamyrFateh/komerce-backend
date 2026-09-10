'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const source = fs.readFileSync(path.join(ROOT, 'routes', 'admin-market-settlement.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(ROOT, 'bootstrap', 'api-routes.js'), 'utf8');

describe('admin settlement routes — central-only boundary', () => {
  test('READY et PAID exigent authenticate + rôle central admin/finance', () => {
    expect(source).toMatch(/const centralFinance = \[authenticate, requireRole\(\['admin', 'finance'\]\)\]/);
    expect(source).toMatch(/settlements\/ready', \.\.\.centralFinance/);
    expect(source).toMatch(/settlements\/:settlementId\/paid', \.\.\.centralFinance/);
  });

  test('READY accepte le montant attesté mais dérive market/assignment/currency côté serveur', () => {
    expect(source).toMatch(/allowAmount: true/);
    expect(source).toMatch(/resolveActiveAssignmentByMarketCode/);
    expect(source).toMatch(/marketId: authz\.market_id/);
    expect(source).toMatch(/assignmentId: authz\.assignment_id/);
    expect(source).not.toMatch(/currency:\s*body\.currency/);
  });

  test('PAID exige une référence de paiement et n’accepte pas un nouveau montant', () => {
    expect(source).toMatch(/paymentReference: req\.body && req\.body\.payment_reference/);
    expect(source).toMatch(/forbidden\.push\('amount'\)/);
  });

  test('routes centrales montées exactement une fois', () => {
    expect(bootstrap).toMatch(/const adminMarketSettlementRouter = require\('\.\.\/routes\/admin-market-settlement'\)/);
    const mounts = bootstrap.match(/app\.use\('\/api\/admin\/market-settlements', adminMarketSettlementRouter\)/g) || [];
    expect(mounts).toHaveLength(1);
  });
});
