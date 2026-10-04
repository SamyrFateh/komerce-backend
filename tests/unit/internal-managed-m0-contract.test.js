'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

test('M0 — INTERNAL_MANAGED reste un mode de gestion, jamais un provider', () => {
  const authority = read('services/suppliers/provider-authority.js');

  expect(authority).toContain('provider identity ≠ execution mode');
  expect(authority).not.toMatch(/['\"]internal_managed['\"]/i);
  expect(authority).not.toMatch(/['\"]manual['\"]/i);
});

test('M0 — CSV et Manual passent par le contrat normalisé existant', () => {
  const csv = read('services/suppliers/connectors/csv-connector.js');
  const manual = read('services/suppliers/connectors/manual-connector.js');

  expect(csv).toContain("require('../normalized-product')");
  expect(csv).toContain('partitionValid(normalized)');
  expect(manual).toContain("require('../normalized-product')");
  expect(manual).toContain('partitionValid(toValidate)');
  expect(manual).toContain("obj.schema_version = '2'");
});

test('M0 — une vente LOCAL_STOCK ne déclenche pas de nouvelle obligation fournisseur', () => {
  const purchasing = read('services/purchasing-trigger-service.js');

  expect(purchasing).toContain("item.fulfillment_source === 'LOCAL_STOCK'");
  expect(purchasing).toContain("status: 'local_stock_no_purchase'");
});

test('M0 — la doctrine interdit les écritures directes catalogue depuis les fichiers', () => {
  const doctrine = read('docs/doctrine/DOCTRINE_INTERNAL_MANAGED_CATALOG.md');

  expect(doctrine).toContain('Aucune source gérée manuellement ne peut écrire directement');
  expect(doctrine).toContain('`products`');
  expect(doctrine).toContain('`product_skus`');
  expect(doctrine).toContain('XLSX doit être un adapter de transport');
  expect(doctrine).toContain('Une vente sur stock interne ne doit jamais créer artificiellement une dette fournisseur');
});
