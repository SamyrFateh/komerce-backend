'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const route = fs.readFileSync(path.join(ROOT, 'routes/market-delegation-cash-control.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(ROOT, 'bootstrap/api-routes.js'), 'utf8');
const migration = fs.readFileSync(path.join(ROOT, 'migrations/198_market_cash_control_policy.sql'), 'utf8');
const registry = require('../../config/market-delegation-capabilities');

describe('market-delegation cash control API contract', () => {
  test('les deux routes sont authentifiées et montées au composition root', () => {
    expect(route).toMatch(/router\.get\('\/markets\/:marketCode\/cash-control-policy', authenticate/);
    expect(route).toMatch(/router\.put\('\/markets\/:marketCode\/cash-control-policy', authenticate/);
    expect(bootstrap).toContain("require('../routes/market-delegation-cash-control')");
    expect(bootstrap).toContain("app.use('/api/market-delegation', marketDelegationCashControlRouter)");
  });

  test('garde des espèces (288) : lecture + destinations authentifiées, activation par verbe, market_id client refusé', () => {
    expect(route).toMatch(/router\.get\('\/markets\/:marketCode\/cash-custody', authenticate/);
    expect(route).toMatch(/router\.post\('\/markets\/:marketCode\/cash-custody\/destinations', authenticate/);
    expect(route).toMatch(/cash-custody\/destinations\/:destinationId\/:verb', authenticate/);
    expect(route.match(/rejectClientMarketId\(req\.body\)/g).length).toBeGreaterThanOrEqual(3);
  });

  test('cash.custody.receive : EXECUTION MARKET DELEGABLE LIVE, à montant, auditable', () => {
    expect(registry.CAPABILITIES.find(row => row.capability === 'cash.custody.receive')).toMatchObject({
      class: 'EXECUTION', authority_scope: 'MARKET', delegation_mode: 'DELEGABLE', requires_audit: true, status: 'LIVE', amount_bearing: true,
    });
  });

  test('le body market_id/marketId est refusé explicitement', () => {
    expect(route).toMatch(/body\.market_id/);
    expect(route).toMatch(/body\.marketId/);
    expect(route).toContain('MARKET_ID_FORBIDDEN');
  });

  test('cash_control.policy.manage est DELEGATION MARKET LIVE et auditable', () => {
    const cap = registry.CAPABILITIES.find(row => row.capability === 'cash_control.policy.manage');
    expect(cap).toMatchObject({
      class: 'DELEGATION',
      authority_scope: 'MARKET',
      delegation_mode: 'DELEGABLE',
      requires_audit: true,
      status: 'LIVE',
    });
    // Le compte global d'autonomie n'est pas le sujet de ce test : il est
    // détenu par le cliquet unique (CHECKPOINT) et vérifié une seule fois,
    // dans market-delegation-p0.test.js. L'assertion qui vivait ici obligeait
    // à corriger le même chiffre dans un troisième fichier à chaque lot.
  });

  test('la migration garantit l’alignement policy.assignment → market et ne crée aucun scope GROUP', () => {
    expect(migration).toContain('enforce_cash_policy_assignment_market');
    expect(migration).toMatch(/v_market_id IS DISTINCT FROM NEW\.market_id/);
    expect(migration).toContain("'cash_control.policy.manage'");
    expect(migration).not.toMatch(/authority_scope\s*=\s*'GROUP'/);
  });
});
