'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  __dirname,
  '../../migrations/224_product_skus_supplier_order_identity.sql'
);

function sql() {
  return fs.readFileSync(migrationPath, 'utf8');
}

describe('migration 224 — product_skus Supplier Order Identity', () => {
  test('adds canonical nullable persistence columns', () => {
    const text = sql();
    expect(text).toMatch(/ADD COLUMN IF NOT EXISTS supplier_unit_ref text/i);
    expect(text).toMatch(/ADD COLUMN IF NOT EXISTS supplier_order_identity jsonb/i);
  });

  test('requires a unit ref when an order identity exists', () => {
    const text = sql();
    expect(text).toMatch(/supplier_order_identity IS NULL\s+OR \(\s+supplier_unit_ref IS NOT NULL/i);
    expect(text).toMatch(/jsonb_typeof\(supplier_order_identity->'payload'\) = 'object'/i);
  });

  test('prevents two SKU of one product from owning the same supplier unit ref', () => {
    const text = sql();
    expect(text).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS ux_product_skus_supplier_unit_ref/i);
    expect(text).toMatch(/ON public\.product_skus \(product_id, supplier_unit_ref\)/i);
  });

  test('contains no historical identity backfill', () => {
    const text = sql();
    expect(text).not.toMatch(/UPDATE\s+public\.product_skus\s+SET\s+supplier_(?:unit_ref|order_identity)/i);
    expect(text).toMatch(/Pas de backfill/i);
  });
});
