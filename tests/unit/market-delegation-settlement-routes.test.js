'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const routeSource = fs.readFileSync(path.join(ROOT, 'routes', 'market-delegation-settlement.js'), 'utf8');
const bootstrapSource = fs.readFileSync(path.join(ROOT, 'bootstrap', 'api-routes.js'), 'utf8');

describe('market-delegation settlement routes — authority contract', () => {
  test('les trois routes sont authentifiées et aucune garde de rôle global n’autorise le pays', () => {
    expect(routeSource).toMatch(/router\.get\('\/markets\/:marketCode\/settlements', authenticate/);
    expect(routeSource).toMatch(/router\.post\('\/markets\/:marketCode\/settlements\/:settlementId\/request', authenticate/);
    expect(routeSource).toMatch(/router\.post\('\/markets\/:marketCode\/settlements\/:settlementId\/receive', authenticate/);
    expect(routeSource).not.toMatch(/requireRole/);
  });

  test('finance.act et settlement.receive restent des capabilities distinctes', () => {
    expect(routeSource).toMatch(/requestSettlement/);
    expect(routeSource).toMatch(/confirmSettlementReceived/);
  });

  test('REQUEST n’accepte aucun champ et RECEIVE seulement receipt_note', () => {
    expect(routeSource).toMatch(/assertDelegatedBody\(req\.body, \[\]\)/);
    expect(routeSource).toMatch(/assertDelegatedBody\(req\.body, \['receipt_note'\]\)/);
  });

  test('amount/currency/market_id et preuve de paiement sont explicitement hors autorité opérateur', () => {
    for (const field of ['market_id', 'marketId', 'amount', 'currency', 'payment_reference', 'paid_at', 'paid_by']) {
      expect(routeSource).toContain(`'${field}'`);
    }
    expect(routeSource).toMatch(/SETTLEMENT_FINANCIAL_AUTHORITY_NOT_DELEGATED/);
    expect(routeSource).toMatch(/MARKET_ID_FORBIDDEN/);
    expect(routeSource).toMatch(/SETTLEMENT_FIELD_FORBIDDEN/);
  });

  test('aucune route pays ne peut créer READY ou marquer PAID', () => {
    expect(routeSource).not.toMatch(/settlements\/ready/);
    expect(routeSource).not.toMatch(/settlementId\/paid/);
    expect(routeSource).not.toMatch(/markPaid/);
    expect(routeSource).not.toMatch(/createReadySettlement/);
  });

  test('API settlement déléguée est montée exactement une fois', () => {
    expect(bootstrapSource).toMatch(/const marketDelegationSettlementRouter = require\('\.\.\/routes\/market-delegation-settlement'\)/);
    const mounts = bootstrapSource.match(/app\.use\('\/api\/market-delegation', marketDelegationSettlementRouter\)/g) || [];
    expect(mounts).toHaveLength(1);
  });
});
