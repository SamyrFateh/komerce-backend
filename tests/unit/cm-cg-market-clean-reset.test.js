'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const reset = require('../../scripts/cm-cg-market-clean-reset');

const ROOT = path.join(__dirname, '..', '..');

describe('CG/CM clean manager reset', () => {
  test('is hard-coded to staging CG/CM and the two known legacy manager identities', () => {
    expect(reset.TARGET_CODES).toEqual(['CG', 'CM']);
    expect(reset.TARGET_USERS).toEqual([
      {
        id: 'a85a778e-72c7-43fd-9963-678920ee34e8',
        email: 'jeanfrancois@komerce.co',
        full_name: 'Jean-Français Koyamba',
      },
      {
        id: '417ebd74-7c1a-4698-ba4c-a81f55842567',
        email: 'antoine@komerce.co',
        full_name: 'Pagbe Baleba',
      },
    ]);

    expect(() => reset.assertRuntime('execute', {
      DATABASE_URL: 'postgres://x/y',
      KOMERCE_ENV: 'production',
      KOMERCE_MARKET_CLEAN_RESET_ACK: 'CG,CM',
    })).toThrow(/staging/);

    expect(() => reset.assertRuntime('execute', {
      DATABASE_URL: 'postgres://x/y',
      KOMERCE_ENV: 'staging',
      KOMERCE_MARKET_CLEAN_RESET_ACK: 'wrong',
    })).toThrow(/KOMERCE_MARKET_CLEAN_RESET_ACK=CG,CM/);
  });

  test('preserves Market IDs and refuses business-history deletion', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'scripts', 'cm-cg-market-clean-reset.js'),
      'utf8'
    );
    expect(source).not.toMatch(/DELETE FROM markets/);
    expect(source).not.toMatch(/DELETE FROM orders/);
    expect(source).not.toMatch(/DELETE FROM mobile_money_transactions/);
    expect(source).not.toMatch(/DELETE FROM market_settlements/);
    expect(source).toMatch(/orders_history/);
    expect(source).toMatch(/mobile_money_history/);
    expect(source).toMatch(/settlements_history/);
  });

  test('deletes legacy delegation state and known users only after remaining FK audit', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'scripts', 'cm-cg-market-clean-reset.js'),
      'utf8'
    );
    expect(source).toMatch(/DELETE FROM market_delegation_audit/);
    expect(source).toMatch(/DELETE FROM operator_market_scopes/);
    expect(source).toMatch(/DELETE FROM assignment_memberships/);
    expect(source).toMatch(/DELETE FROM market_operating_assignments/);
    expect(source).toMatch(/remainingUserReferences/);
    expect(source.indexOf('remainingUserReferences')).toBeLessThan(source.indexOf('DELETE FROM users'));
  });
});
