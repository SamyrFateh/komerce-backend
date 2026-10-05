'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const reset = require('../../scripts/cm-cg-market-reprovision-reset');

const ROOT = path.join(__dirname, '..', '..');

describe('CG/CM controlled reprovision reset', () => {
  test('scope is hard-coded, dry-run is read-only anywhere, execution requires staging acknowledgement', () => {
    expect(() => reset.assertRuntime('dry-run', {
      KOMERCE_ENV: 'production',
      DATABASE_URL: 'postgres://x/y',
    })).not.toThrow();
    expect(reset.TARGET_CODES).toEqual(['CG', 'CM']);
    expect(() => reset.assertRuntime('execute', {
      KOMERCE_ENV: 'staging',
      DATABASE_URL: 'postgres://x/y',
      KOMERCE_MARKET_RESET_ACK: 'no',
    })).toThrow(/KOMERCE_MARKET_RESET_ACK=CG,CM/);

    expect(() => reset.assertRuntime('execute', {
      KOMERCE_ENV: 'production',
      DATABASE_URL: 'postgres://x/y',
      KOMERCE_MARKET_RESET_ACK: 'CG,CM',
    })).toThrow(/staging/);
  });

  test('preserves market identity and business history', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'scripts', 'cm-cg-market-reprovision-reset.js'),
      'utf8'
    );
    expect(source).not.toMatch(/DELETE FROM markets/);
    expect(source).not.toMatch(/DELETE FROM orders/);
    expect(source).not.toMatch(/DELETE FROM mobile_money_transactions/);
    expect(source).toMatch(/orders_history/);
    expect(source).toMatch(/mobile_money_history/);
  });

  test('retires legacy runtime configuration without deleting authority history', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'scripts', 'cm-cg-market-reprovision-reset.js'),
      'utf8'
    );
    expect(source).toMatch(/UPDATE operator_market_scopes/);
    expect(source).toMatch(/UPDATE membership_capabilities/);
    expect(source).toMatch(/UPDATE assignment_memberships/);
    expect(source).toMatch(/status='ENDED'/);
    expect(source).toMatch(/UPDATE relais/);
    expect(source).toMatch(/is_active=FALSE/);
    expect(source).toMatch(/DELETE FROM market_payment_providers/);
    expect(source).toMatch(/lifecycle_status='PROVISIONING'/);
  });
});
