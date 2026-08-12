'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const migration = fs.readFileSync(
  path.join(__dirname, '../../migrations/130_deactivate_catalog_test_placeholders.sql'),
  'utf8'
);

describe('migration 130 — isolation des placeholders catalogue', () => {
  test('désactive sans supprimer et cible les deux signatures de test documentées', () => {
    expect(migration).toMatch(/UPDATE products/);
    expect(migration).toMatch(/is_active\s*=\s*FALSE/);
    expect(migration).toMatch(/is_available\s*=\s*FALSE/);
    expect(migration).toMatch(/\^title/);
    expect(migration).toMatch(/\^desc/);
    expect(migration).toMatch(/\^Raw test product:/);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+products/i);
  });
});
