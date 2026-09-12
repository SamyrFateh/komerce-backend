'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(
  path.join(__dirname, '../../migrations/225_product_skus_supplier_product_ref.sql'),
  'utf8'
);

describe('migration 225 — product_skus supplier_product_ref', () => {
  test('ajoute la référence produit fournisseur sans backfill', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS supplier_product_ref text/i);
    expect(sql).toMatch(/supplier_product_ref IS NULL OR btrim\(supplier_product_ref\) <> ''/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.product_skus/i);
    expect(sql).not.toMatch(/sourcing_candidates/i);
  });
});
