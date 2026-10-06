'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const reset = require('../../scripts/cm-cg-market-full-reset');

const ROOT = path.join(__dirname, '..', '..');

describe('CG/CM full market reset', () => {
  test('is hard-coded, staging-only and requires destructive acknowledgement', () => {
    expect(reset.TARGET_CODES).toEqual(['CG', 'CM']);
    expect(reset.ACK).toBe('DELETE-CG-CM');

    expect(() => reset.assertRuntime('execute', {
      DATABASE_URL: 'postgres://x/y',
      KOMERCE_ENV: 'production',
      KOMERCE_MARKET_FULL_RESET_ACK: 'DELETE-CG-CM',
    })).toThrow(/staging/);

    expect(() => reset.assertRuntime('execute', {
      DATABASE_URL: 'postgres://x/y',
      KOMERCE_ENV: 'staging',
      KOMERCE_MARKET_FULL_RESET_ACK: 'no',
    })).toThrow(/KOMERCE_MARKET_FULL_RESET_ACK=DELETE-CG-CM/);
  });

  test('protects business facts and really deletes the market rows only after FK cleanup', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'scripts', 'cm-cg-market-full-reset.js'),
      'utf8'
    );

    for (const table of ['orders','mobile_money_transactions','market_settlements']) {
      expect(reset.PROTECTED_TABLES.has(table)).toBe(true);
    }
    expect(source).toMatch(/protected_refs/);
    expect(source).toMatch(/DELETE FROM markets WHERE id=ANY/);
    expect(source.indexOf('remaining.length')).toBeLessThan(source.indexOf('DELETE FROM markets WHERE id=ANY'));
  });

  test('discovers market foreign keys from PostgreSQL instead of maintaining a blind table list', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'scripts', 'cm-cg-market-full-reset.js'),
      'utf8'
    );
    expect(source).toMatch(/pg_constraint/);
    expect(source).toMatch(/ref\.relname='markets'/);
    expect(source).toMatch(/array_length\(con\.conkey,1\)=1/);
  });
});
