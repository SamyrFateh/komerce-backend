'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(
  path.resolve(__dirname, '../../migrations/119_economic_variables_to_finance_config.sql'),
  'utf8'
);

const CURRENT = {
  customs_rate_default_pct: 42,
  mix_rail_a: 60,
  mix_rail_b: 25,
  mix_rail_c: 10,
  mix_rail_d: 5,
  margin_rail_a: 45,
  margin_rail_b: 18,
  margin_rail_c: 35,
  margin_rail_d: 70,
};

describe('migration 119 — economic_variables -> finance_config', () => {
  test.each(Object.entries(CURRENT))('ajoute %s avec le fallback CURRENT %s', (key, value) => {
    expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${key}\\s+NUMERIC\\(5,2\\)`, 'i'));
    expect(sql).toMatch(new RegExp(`ALTER COLUMN ${key} SET DEFAULT ${value}`, 'i'));
    expect(sql).toMatch(new RegExp(`ALTER COLUMN ${key} SET NOT NULL`, 'i'));
  });

  test.each(Object.entries(CURRENT))('copie %s avec priorité value_used > value_supposed', (key, value) => {
    const keyPattern = new RegExp(
      `COALESCE\\(value_used, value_supposed\\)::numeric FROM economic_variables[\\s\\S]{0,120}key = '${key}'`,
      'i'
    );
    expect(sql).toMatch(keyPattern);
  });

  test('est safe si la table legacy est absente au releaseCommand', () => {
    expect(sql).toContain("to_regclass('public.economic_variables') IS NOT NULL");
    expect(sql).toContain('EXECUTE $legacy_copy$');
    expect(sql).toMatch(/ELSE[\s\S]*UPDATE finance_config[\s\S]*COALESCE\(customs_rate_default_pct, 42\)/i);
  });

  test('ne mute jamais economic_variables', () => {
    expect(sql).not.toMatch(/UPDATE\s+economic_variables/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+economic_variables/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+economic_variables/i);
  });
});
