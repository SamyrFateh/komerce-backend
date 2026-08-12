#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-showcase-v2-full-reset
 * @domain        catalog
 * @layer         script
 * @criticality   medium
 * @inputs        railway_staging synthetic SHOWCASE-V2 data
 * @outputs       clean V2 staging baseline
 * @depends       db.js
 * @used-by       showcase v2 staging deploy
 * @db-read       products, order_items, sourcing_candidates, supplier_catalog_imports
 * @db-write      products, sourcing_candidates, supplier_catalog_imports
 * @db-txn        yes
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md
 * @version       2026-08-v1
 */
'use strict';

const db = require('../db');

const SUPPLIER_NAME = 'Komerce Showcase V2';
const V1_PATTERN = 'SHOWCASE-V1-%';
const V2_PATTERN = 'SHOWCASE-V2-%';

function assertStaging() {
  if (process.env.NODE_ENV === 'production' || process.env.KOMERCE_ENV === 'production') {
    throw new Error('REFUS: reset Showcase V2 interdit en production');
  }
  if (process.env.KOMERCE_ALLOW_SHOWCASE_SEED !== '1') {
    throw new Error('KOMERCE_ALLOW_SHOWCASE_SEED=1 requis');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requis');
}

async function snapshot(client) {
  const { rows: [row] } = await client.query(
    `SELECT
       (SELECT COUNT(*)::int FROM products WHERE is_active=TRUE AND product_ref LIKE $1) AS v1_active,
       (SELECT COUNT(*)::int FROM products WHERE product_ref LIKE $2) AS v2_products,
       (SELECT COUNT(*)::int FROM sourcing_candidates
          WHERE supplier_name=$3 AND supplier_product_id LIKE $2) AS v2_candidates,
       (SELECT COUNT(*)::int FROM supplier_catalog_imports WHERE supplier_name=$3) AS v2_imports`,
    [V1_PATTERN, V2_PATTERN, SUPPLIER_NAME],
  );
  return row;
}

async function assertNoOrderedV2(client) {
  const { rows: [row] } = await client.query(
    `SELECT COUNT(*)::int AS count
       FROM order_items oi
       JOIN products p ON p.id=oi.product_id
      WHERE p.product_ref LIKE $1`,
    [V2_PATTERN],
  );
  if (row.count > 0) {
    throw new Error(`REFUS reset V2: ${row.count} ligne(s) de commande référencent SHOWCASE-V2`);
  }
}

async function resetShowcaseV2() {
  assertStaging();
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const before = await snapshot(client);
    await assertNoOrderedV2(client);

    // Les events candidats sont ON DELETE CASCADE. Les enfants catalogue V2
    // (SKU, média, contenu...) sont également attachés aux products en CASCADE.
    const candidates = await client.query(
      `DELETE FROM sourcing_candidates
        WHERE supplier_name=$1 AND supplier_product_id LIKE $2
        RETURNING id`,
      [SUPPLIER_NAME, V2_PATTERN],
    );

    const products = await client.query(
      `DELETE FROM products
        WHERE product_ref LIKE $1
        RETURNING id`,
      [V2_PATTERN],
    );

    const imports = await client.query(
      `DELETE FROM supplier_catalog_imports i
        WHERE i.supplier_name=$1
          AND NOT EXISTS (SELECT 1 FROM sourcing_candidates c WHERE c.import_id=i.id)
        RETURNING id`,
      [SUPPLIER_NAME],
    );

    const after = await snapshot(client);
    if (after.v2_products !== 0 || after.v2_candidates !== 0) {
      throw new Error(
        `Reset V2 incomplet: products=${after.v2_products}, candidates=${after.v2_candidates}`
      );
    }
    if (after.v1_active !== before.v1_active) {
      throw new Error(`Invariant V1 cassé: avant=${before.v1_active}, après=${after.v1_active}`);
    }

    await client.query('COMMIT');
    const result = {
      before,
      deleted: {
        candidates: candidates.rowCount,
        products: products.rowCount,
        imports: imports.rowCount,
      },
      after,
    };
    console.log(`[showcase-v2-reset] ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  try {
    await resetShowcaseV2();
  } finally {
    await db.pool.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[showcase-v2-reset] échec:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  SUPPLIER_NAME,
  V1_PATTERN,
  V2_PATTERN,
  assertStaging,
  snapshot,
  assertNoOrderedV2,
  resetShowcaseV2,
};
