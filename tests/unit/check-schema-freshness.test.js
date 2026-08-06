'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/check-schema-freshness.test.js
 *
 * Couvre les fonctions pures de scripts/check-schema-freshness.js :
 * extraction (ADD COLUMN / CREATE TABLE / CREATE VIEW / DROP TABLE / DROP
 * VIEW), présence dans le dump, et evaluateFreshness (baseline vs --all,
 * suivi de cycle de vie create→drop).
 *
 * baselineFromDumpCommit() fait de l'I/O git réelle et n'est pas testé ici,
 * même convention que check-sku-coverage.test.js pour les scripts/ (I/O
 * hors périmètre, seules les fonctions pures sont couvertes).
 */

const {
  extractAddColumns,
  extractCreatedObjects,
  extractDroppedObjects,
  objectExistsInSchema,
  evaluateFreshness,
} = require('../../scripts/check-schema-freshness');

function migration(fname, sql) {
  return { fname, sql };
}

describe('extractAddColumns', () => {
  test('détecte une colonne ADD COLUMN simple', () => {
    const result = extractAddColumns('ALTER TABLE products ADD COLUMN inventory_model text;');
    expect(result).toEqual([{ table: 'products', col: 'inventory_model' }]);
  });

  test('ignore une ligne de commentaire mentionnant ADD COLUMN', () => {
    const sql = '-- ancienne note : ALTER TABLE products ADD COLUMN legacy_flag boolean;\nSELECT 1;';
    expect(extractAddColumns(sql)).toEqual([]);
  });
});

describe('extractCreatedObjects — CREATE TABLE / CREATE VIEW', () => {
  test('cas 3 — CREATE TABLE présente est détectée', () => {
    const result = extractCreatedObjects('CREATE TABLE catalog_enrichment_runs (id uuid);');
    expect(result).toContainEqual({ kind: 'table', name: 'catalog_enrichment_runs' });
  });

  test('cas 5 — CREATE TABLE IF NOT EXISTS public.product_skus est détectée', () => {
    const result = extractCreatedObjects('CREATE TABLE IF NOT EXISTS public.product_skus (id uuid);');
    expect(result).toContainEqual({ kind: 'table', name: 'product_skus' });
  });

  test('cas 6 — CREATE VIEW est détectée', () => {
    const result = extractCreatedObjects('CREATE VIEW parcel_reconciliation_view AS SELECT 1;');
    expect(result).toContainEqual({ kind: 'view', name: 'parcel_reconciliation_view' });
  });

  test('CREATE OR REPLACE VIEW est détectée', () => {
    const result = extractCreatedObjects('CREATE OR REPLACE VIEW public.parcel_reconciliation_view AS SELECT 1;');
    expect(result).toContainEqual({ kind: 'view', name: 'parcel_reconciliation_view' });
  });

  test('régression — un commentaire "-- Idempotente : CREATE TABLE IF NOT EXISTS ..." n\'est pas capté', () => {
    const sql = [
      '-- Idempotente : CREATE TABLE IF NOT EXISTS protège les envs déjà migrés.',
      "SET client_encoding = 'UTF8';",
    ].join('\n');
    expect(extractCreatedObjects(sql)).toEqual([]);
  });
});

describe('extractDroppedObjects', () => {
  test('détecte un DROP TABLE IF EXISTS', () => {
    const result = extractDroppedObjects('DROP TABLE IF EXISTS shared_cart_commitments;');
    expect(result).toContainEqual({ kind: 'table', name: 'shared_cart_commitments' });
  });

  test('ignore un DROP TABLE en commentaire', () => {
    const sql = '-- historique : on faillait DROP TABLE old_stuff ici avant\nSELECT 1;';
    expect(extractDroppedObjects(sql)).toEqual([]);
  });
});

describe('objectExistsInSchema', () => {
  test('trouve une table réellement créée dans le dump (pas une simple sous-chaîne)', () => {
    const schema = 'create table public.product_skus (id uuid primary key);';
    expect(objectExistsInSchema(schema, { kind: 'table', name: 'product_skus' })).toBe(true);
  });

  test('ne se laisse pas abuser par une FK qui référence le nom de la table', () => {
    // "product_skus" apparaît dans le dump seulement via une FK, la table n'existe pas
    const schema = 'create table order_items (sku_id uuid references product_skus(id));';
    expect(objectExistsInSchema(schema, { kind: 'table', name: 'product_skus' })).toBe(false);
  });

  test('trouve une vue créée dans le dump', () => {
    const schema = 'create view parcel_reconciliation_view as select 1;';
    expect(objectExistsInSchema(schema, { kind: 'view', name: 'parcel_reconciliation_view' })).toBe(true);
  });
});

describe('evaluateFreshness', () => {
  test('cas 1 — ADD COLUMN présente dans le dump → PASS', () => {
    const migrations = [migration('090_x.sql', 'ALTER TABLE products ADD COLUMN foo text;')];
    const schema = 'create table products (id uuid, foo text);';
    const { missing } = evaluateFreshness({ schema, migrations, baselineFiles: null, requireAll: true });
    expect(missing).toHaveLength(0);
  });

  test('cas 2 — ADD COLUMN absente du dump → FAIL', () => {
    const migrations = [migration('090_x.sql', 'ALTER TABLE products ADD COLUMN foo text;')];
    const schema = 'create table products (id uuid);';
    const { missing } = evaluateFreshness({ schema, migrations, baselineFiles: null, requireAll: true });
    expect(missing).toContainEqual({ fname: '090_x.sql', kind: 'column', table: 'products', col: 'foo' });
  });

  test('cas 4 — CREATE TABLE absente du dump → FAIL', () => {
    const migrations = [migration('100_x.sql', 'CREATE TABLE catalog_enrichment_runs (id uuid);')];
    const schema = 'create table products (id uuid);';
    const { missing } = evaluateFreshness({ schema, migrations, baselineFiles: null, requireAll: true });
    expect(missing).toContainEqual({ fname: '100_x.sql', kind: 'table', name: 'catalog_enrichment_runs' });
  });

  test('cas 7 — CREATE VIEW absente du dump → FAIL', () => {
    const migrations = [migration('094_x.sql', 'CREATE VIEW parcel_reconciliation_view AS SELECT 1;')];
    const schema = 'create table products (id uuid);';
    const { missing } = evaluateFreshness({ schema, migrations, baselineFiles: null, requireAll: true });
    expect(missing).toContainEqual({ fname: '094_x.sql', kind: 'view', name: 'parcel_reconciliation_view' });
  });

  test('cas 8 — migration post-snapshot ignorée en mode baseline normal', () => {
    const migrations = [
      migration('090_baseline.sql', 'ALTER TABLE products ADD COLUMN foo text;'),
      migration('104_product_skus.sql', 'CREATE TABLE product_skus (id uuid);'),
    ];
    const schema = 'create table products (id uuid, foo text);'; // 104 absente, mais hors baseline
    const baselineFiles = new Set(['090_baseline.sql']);
    const { missing, pending } = evaluateFreshness({ schema, migrations, baselineFiles, requireAll: false });
    expect(missing).toHaveLength(0);
    expect(pending).toEqual(['104_product_skus.sql']);
  });

  test('cas 9 — la même migration devient obligatoire en --all', () => {
    const migrations = [
      migration('090_baseline.sql', 'ALTER TABLE products ADD COLUMN foo text;'),
      migration('104_product_skus.sql', 'CREATE TABLE product_skus (id uuid);'),
    ];
    const schema = 'create table products (id uuid, foo text);';
    const baselineFiles = new Set(['090_baseline.sql']);
    const { missing } = evaluateFreshness({ schema, migrations, baselineFiles, requireAll: true });
    expect(missing).toContainEqual({ fname: '104_product_skus.sql', kind: 'table', name: 'product_skus' });
  });

  test('régression — objet créé puis re-droppé par une migration in-scope ultérieure (table zombie) n\'est pas exigé du dump', () => {
    const migrations = [
      migration('071b_shared_cart_commitments.sql', 'CREATE TABLE shared_cart_commitments (id uuid);'),
      migration('099_drop_zombie.sql', 'DROP TABLE IF EXISTS shared_cart_commitments;'),
    ];
    const schema = 'create table products (id uuid);'; // shared_cart_commitments absente, et c\'est voulu
    const { missing } = evaluateFreshness({ schema, migrations, baselineFiles: null, requireAll: true });
    expect(missing).toHaveLength(0);
  });

  test('un drop porté par une migration post-snapshot (hors scope) n\'annule PAS l\'exigence de la création baseline', () => {
    const migrations = [
      migration('071b_x.sql', 'CREATE TABLE shared_cart_commitments (id uuid);'),
      migration('099_drop_zombie.sql', 'DROP TABLE IF EXISTS shared_cart_commitments;'),
    ];
    const schema = 'create table products (id uuid);';
    // Seule 071b est en baseline : le drop de 099 n'a "pas encore eu lieu" du point de vue du dump.
    const baselineFiles = new Set(['071b_x.sql']);
    const { missing, pending } = evaluateFreshness({ schema, migrations, baselineFiles, requireAll: false });
    expect(missing).toContainEqual({ fname: '071b_x.sql', kind: 'table', name: 'shared_cart_commitments' });
    expect(pending).toEqual(['099_drop_zombie.sql']);
  });
});
