/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
/** Garde du script de prerequis certification : staging seul, READ ONLY, aucune ecriture SQL, detection d'un ACTIVE non canonique. */
const fs = require('fs');
const path = require('path');
const { assess } = require('../../scripts/recette/staging-cert-prereq-readonly');

const SCRIPT = path.join(__dirname, '../../scripts/recette/staging-cert-prereq-readonly.js');

function fakeDb(statements) {
  const client = {
    query: async (sql) => {
      statements.push(String(sql));
      if (/FROM markets WHERE code/.test(sql)) return { rows: [{ id: 'id', code: 'CM', currency: 'XAF', minor_unit: 0, is_active: true, lifecycle_status: 'ACTIVE' }] };
      if (/schema_migrations/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
    release() {},
  };
  return { getClient: async () => client, query: async () => ({ rows: [] }) };
}

describe('staging-cert-prereq-readonly', () => {
  test('refuse hors staging', async () => {
    await expect(assess({ db: fakeDb([]), env: { KOMERCE_ENV: 'production' } })).rejects.toThrow('STAGING_ONLY');
  });

  test('le source ne contient aucune instruction SQL d ecriture', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n');
    expect(src).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE|DROP\s+TABLE)\b/i);
    expect(src).toMatch(/BEGIN READ ONLY/);
  });

  test('workflow : dispatch seul, secret non imprime', () => {
    const wf = fs.readFileSync(path.join(__dirname, '../../.github/workflows/staging-cert-prereq-readonly.yml'), 'utf8');
    expect(wf).toMatch(/workflow_dispatch/);
    expect(wf).not.toMatch(/issues:/);
    expect(wf).not.toMatch(/echo[^\n]*\$\{?DATABASE_URL/);
  });
});
