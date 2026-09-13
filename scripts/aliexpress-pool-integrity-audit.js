#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          aliexpress-pool-integrity-audit
 * @domain        catalog
 * @layer         tooling
 * @criticality   medium
 * @inputs        DATABASE_URL, KOMERCE_ENV=staging
 * @outputs       read-only AliExpress pool cardinality and duplicate diagnostics
 * @depends       db.js
 * @used-by       bounded GitHub staging catalog operations
 * @db-read       sourcing_candidates
 * @db-write      none
 * @db-txn        none
 * @doctrine      observe_before_behavior_change, supplier_identity_no_guessing
 * @impact-areas  sourcing, catalog, staging
 * @version       2026-09-v1
 */
'use strict';

const db = require('../db');

const SUPPLIER = 'AliExpress';

function assertRuntime(env = process.env) {
  const runtime = String(env.KOMERCE_ENV || '').trim().toLowerCase();
  if (runtime !== 'staging') throw new Error(`REFUS: KOMERCE_ENV=staging requis (reçu: ${runtime || '<vide>'})`);
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
}

function cleanStockSql(alias = 'sc') {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`Alias SQL invalide: ${alias}`);
  return `(
    ${alias}.normalized_source_contract ? 'stock_available'
    AND (${alias}.normalized_source_contract->>'stock_available') ~ '^[0-9]+([.][0-9]+)?$'
    AND (${alias}.normalized_source_contract->>'stock_available')::numeric > 0
  )`;
}

const CLEAN_WHERE = `
  sc.supplier_name = $1
  AND sc.supplier_product_id IS NOT NULL
  AND sc.state IN ('scanned', 'imported_to_catalog')
  AND COALESCE(sc.product_name, '') <> ''
  AND sc.image_url ~ '^https://'
  AND sc.purchase_price IS NOT NULL
  AND sc.purchase_price > 0
  AND ${cleanStockSql('sc')}
`;

async function audit(queryable = db) {
  const { rows: [summary] } = await queryable.query(
    `SELECT
       COUNT(*)::int AS rows_total,
       COUNT(DISTINCT sc.supplier_product_id)::int AS distinct_supplier_products,
       COUNT(*) FILTER (WHERE sc.state = 'scanned')::int AS scanned_rows,
       COUNT(*) FILTER (WHERE sc.state = 'imported_to_catalog')::int AS imported_rows,
       COUNT(DISTINCT sc.product_id) FILTER (WHERE sc.product_id IS NOT NULL)::int AS distinct_catalog_products
     FROM sourcing_candidates sc
     WHERE ${CLEAN_WHERE}`,
    [SUPPLIER]
  );

  const { rows: duplicateGroups } = await queryable.query(
    `SELECT
       sc.supplier_product_id,
       COUNT(*)::int AS copies,
       COUNT(DISTINCT sc.state)::int AS distinct_states,
       ARRAY_AGG(DISTINCT sc.state ORDER BY sc.state) AS states,
       COUNT(DISTINCT sc.product_id) FILTER (WHERE sc.product_id IS NOT NULL)::int AS linked_products,
       MIN(sc.created_at) AS first_seen_at,
       MAX(sc.created_at) AS last_seen_at
     FROM sourcing_candidates sc
     WHERE ${CLEAN_WHERE}
     GROUP BY sc.supplier_product_id
     HAVING COUNT(*) > 1
     ORDER BY copies DESC, sc.supplier_product_id
     LIMIT 50`,
    [SUPPLIER]
  );

  const { rows: [duplicateSummary] } = await queryable.query(
    `WITH grouped AS (
       SELECT sc.supplier_product_id, COUNT(*)::int AS copies
       FROM sourcing_candidates sc
       WHERE ${CLEAN_WHERE}
       GROUP BY sc.supplier_product_id
       HAVING COUNT(*) > 1
     )
     SELECT
       COUNT(*)::int AS duplicate_supplier_products,
       COALESCE(SUM(copies), 0)::int AS rows_in_duplicate_groups,
       COALESCE(SUM(copies - 1), 0)::int AS excess_rows,
       COALESCE(MAX(copies), 0)::int AS max_copies
     FROM grouped`,
    [SUPPLIER]
  );

  return {
    supplier: SUPPLIER,
    ...summary,
    ...duplicateSummary,
    duplicate_sample: duplicateGroups,
  };
}

async function main() {
  assertRuntime();
  const result = await audit();
  console.log(`[aliexpress-pool-integrity-audit] ${JSON.stringify(result, null, 2)}`);
  return result;
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(`[aliexpress-pool-integrity-audit] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  SUPPLIER,
  assertRuntime,
  cleanStockSql,
  audit,
  main,
};
