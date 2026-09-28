#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-full-catalog-reset
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        staging DATABASE_URL
 * @outputs       empty staging catalogue while preserving sourcing pool
 * @depends       db.js
 * @used-by       .github/workflows/staging-catalog-ops.yml
 * @db-read       products, sourcing_candidates, orders
 * @db-write      products, sourcing_candidates, orders
 * @db-txn        yes
 * @doctrine      staging_only, catalog_rebuild_from_canonical_sourcing
 * @impact-areas  staging-catalog, staging-orders, sourcing-promotion-links
 * @version       2026-09
 */
'use strict';

const db = require('../db');

function assertStaging() {
  if (String(process.env.KOMERCE_ENV || '').toLowerCase() !== 'staging') {
    throw new Error('REFUS: KOMERCE_ENV=staging requis');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('REFUS: reset catalogue interdit avec NODE_ENV=production');
  }
  if (process.env.KOMERCE_ALLOW_FULL_CATALOG_RESET !== '1') {
    throw new Error('KOMERCE_ALLOW_FULL_CATALOG_RESET=1 requis');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requis');
}

async function tableExists(client, name) {
  const { rows: [row] } = await client.query('SELECT to_regclass($1) IS NOT NULL AS ok', [`public.${name}`]);
  return Boolean(row?.ok);
}

async function reset() {
  assertStaging();
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows: [before] } = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM products) AS products,
         (SELECT COUNT(*)::int FROM products WHERE is_active=TRUE) AS active_products,
         (SELECT COUNT(*)::int FROM sourcing_candidates) AS sourcing_candidates,
         (SELECT COUNT(*)::int FROM sourcing_candidates WHERE product_id IS NOT NULL) AS linked_candidates,
         (SELECT COUNT(*)::int FROM orders) AS orders`
    );

    // Staging transactions are disposable. Clearing orders first avoids
    // historical product FK restrictions while leaving sourcing/import evidence intact.
    await client.query('TRUNCATE TABLE orders CASCADE');

    for (const table of ['basket_items', 'baskets', 'recipients']) {
      if (await tableExists(client, table)) await client.query(`DELETE FROM ${table}`);
    }

    // Preserve the sourcing pool but make previously promoted candidates eligible
    // for a clean re-promotion after the catalogue is rebuilt.
    const candidates = await client.query(
      `UPDATE sourcing_candidates
          SET product_id = NULL,
              state = CASE WHEN state = 'imported_to_catalog' THEN 'scanned' ELSE state END,
              updated_at = NOW()
        WHERE product_id IS NOT NULL
        RETURNING id`
    );

    const products = await client.query('DELETE FROM products RETURNING id');

    const { rows: [after] } = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM products) AS products,
         (SELECT COUNT(*)::int FROM products WHERE is_active=TRUE) AS active_products,
         (SELECT COUNT(*)::int FROM sourcing_candidates) AS sourcing_candidates,
         (SELECT COUNT(*)::int FROM sourcing_candidates WHERE product_id IS NOT NULL) AS linked_candidates,
         (SELECT COUNT(*)::int FROM orders) AS orders`
    );

    if (after.products !== 0 || after.active_products !== 0 || after.linked_candidates !== 0 || after.orders !== 0) {
      throw new Error(`Reset incomplet: ${JSON.stringify(after)}`);
    }
    if (after.sourcing_candidates !== before.sourcing_candidates) {
      throw new Error(`Pool sourcing altéré: avant=${before.sourcing_candidates}, après=${after.sourcing_candidates}`);
    }

    await client.query('COMMIT');
    const result = {
      before,
      reset_candidates: candidates.rowCount,
      deleted_products: products.rowCount,
      after,
    };
    console.log(`[full-staging-catalog-reset] ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  reset()
    .then(() => db.pool.end().catch(() => {}))
    .catch(async (error) => {
      console.error('[full-staging-catalog-reset] FAILED:', error.message);
      await db.pool.end().catch(() => {});
      process.exitCode = 1;
    });
}

module.exports = { assertStaging, reset };
