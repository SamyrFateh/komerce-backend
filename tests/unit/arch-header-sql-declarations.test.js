'use strict';

/**
 * @test-requires none
 * Les tables lues par ces services doivent figurer dans l'en-tête @db-read
 * (arch-header-sql-check, cliquet 0). Le module est chargé pour de vrai, sans base.
 */
const fs = require('fs');
const path = require('path');

jest.mock('../../db', () => ({ query: jest.fn(), pool: { query: jest.fn(), connect: jest.fn() }, withTransaction: jest.fn() }));

const LOADERS = {
  'catalog-stock-sync-decision': () => require('../../services/catalog-stock-sync-decision'),
  'hub-physical-identity': () => require('../../services/hub-physical-identity'),
  'import-runtime-runs': () => require('../../services/import-runtime-runs'),
  'signal-service': () => require('../../services/signal-service'),
  'sourcing-source-autopilot': () => require('../../services/sourcing-source-autopilot'),
};
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
      expect(() => LOADERS[stem]()).not.toThrow();
      const readLine = fs.readFileSync(file, 'utf8').split('\n').find((l) => /@db-read\b/.test(l));
      for (const t of tables) expect(readLine).toMatch(new RegExp(`\\b${t}\\b`));
    });
  }
});

describe('porte headers/cartes <-> SQL — mode d’accès et carte propriétaire (Lot A2)', () => {
  const core = require('../../scripts/lib/arch-drift-core');

  test('extractSqlTableRefsRW sépare lectures et écritures (DELETE FROM n’est pas une lecture)', () => {
    const { reads, writes } = core.extractSqlTableRefsRW(
      "db.query('SELECT 1 FROM a JOIN b ON true'); db.query('UPDATE c SET x=1'); db.query('DELETE FROM d'); db.query('INSERT INTO e (x) VALUES (1)')"
    );
    expect([...reads].sort()).toEqual(['a', 'b']);
    expect([...writes].sort()).toEqual(['c', 'd', 'e']);
  });

  test('aucune écriture SQL directe déclarée seulement en lecture ou en délégation (stock réconcilié à 0)', () => {
    expect(core.analyzeHeaderSql().writeModeFindings).toEqual([]);
  });

  test('toute écriture SQL d’un fichier de code est déclarée W/RW dans sa carte (39 couples réconciliés, porte stricte à 0)', () => {
    expect(core.analyzeCardWrites().findings).toEqual([]);
  });

  test('scripts/ et tests/ restent hors du périmètre carte (outils et preuves)', () => {
    expect(core.CARD_CODE_CATEGORIES).not.toContain('scripts');
    expect(core.CARD_CODE_CATEGORIES).not.toContain('tests');
  });
});
