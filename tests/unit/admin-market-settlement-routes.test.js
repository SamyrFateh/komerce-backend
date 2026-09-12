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

  test('READY accepte seulement les champs d’attestation et dérive market/assignment/currency côté serveur', () => {
    expect(source).toContain("assertAllowedBody(req.body, ['amount', 'source_reference', 'period_start', 'period_end', 'attestation_note'])");
    expect(source).toMatch(/resolveActiveAssignmentByMarketCode/);
    expect(source).toMatch(/marketId: authz\.market_id/);
    expect(source).toMatch(/assignmentId: authz\.assignment_id/);
    expect(source).not.toMatch(/currency:\s*body\.currency/);
  });

  test('PAID accepte seulement payment_reference et n’accepte pas un nouveau montant', () => {
    expect(source).toContain("assertAllowedBody(req.body, ['payment_reference'])");
    expect(source).toMatch(/paymentReference: req\.body && req\.body\.payment_reference/);
  });

  test('market_id client reste explicitement refusé', () => {
    expect(source).toMatch(/found === 'market_id' \|\| found === 'marketId'/);
    expect(source).toMatch(/MARKET_ID_FORBIDDEN/);
  });

  test('routes centrales montées exactement une fois', () => {
    expect(bootstrap).toMatch(/const adminMarketSettlementRouter = require\('\.\.\/routes\/admin-market-settlement'\)/);
    const mounts = bootstrap.match(/app\.use\('\/api\/admin\/market-settlements', adminMarketSettlementRouter\)/g) || [];
    expect(mounts).toHaveLength(1);
  });
});
