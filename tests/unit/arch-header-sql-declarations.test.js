'use strict';

/**
 * @test-requires none
 * Les tables lues par ces services doivent figurer dans l'en-tête @db-read
 * (arch-header-sql-check, cliquet 0). Le module est chargé pour de vrai, sans base.
 */
const fs = require('fs');
const path = require('path');

jest.mock('../../db', () => ({ query: jest.fn(), pool: { query: jest.fn(), connect: jest.fn() }, withTransaction: jest.fn() }));

const EXPECTED = {
  'catalog-stock-sync-decision': ['purchase_lines'],
  'hub-physical-identity': ['purchase_lines'],
  'import-runtime-runs': ['import_runtime_item_events'],
  'signal-service': ['purchase_lines', 'supplier_execution_events'],
  'sourcing-source-autopilot': ['provider_credentials'],
};

describe('en-têtes @db-read des services (déclarations de tables lues)', () => {
  for (const [stem, tables] of Object.entries(EXPECTED)) {
    test(`${stem} déclare ${tables.join(', ')}`, () => {
      const file = path.join(__dirname, '..', '..', 'services', `${stem}.js`);
      expect(() => require(`../../services/${stem}`)).not.toThrow();
      const readLine = fs.readFileSync(file, 'utf8').split('\n').find((l) => /@db-read\b/.test(l));
      for (const t of tables) expect(readLine).toMatch(new RegExp(`\\b${t}\\b`));
    });
  }
});
