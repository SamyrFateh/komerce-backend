#!/usr/bin/env node
'use strict';

const db = require('../db');

const V1_PATTERN = 'SHOWCASE-V1-%';
const V2_PATTERN = 'SHOWCASE-V2-%';
const GOLDEN_PATTERN = 'GOLDEN-%';

function assertAuthorized() {
  if (process.env.KOMERCE_ALLOW_SHOWCASE_V1_RETIRE !== '1') {
    throw new Error('KOMERCE_ALLOW_SHOWCASE_V1_RETIRE=1 requis');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requis');
}

async function snapshot(client) {
  const { rows: [row] } = await client.query(
    `SELECT
       (SELECT COUNT(*)::int FROM products WHERE product_ref LIKE $1) AS v1_total,
       (SELECT COUNT(*)::int FROM products WHERE product_ref LIKE $1 AND is_active=TRUE) AS v1_active,
       (SELECT COUNT(*)::int FROM products WHERE product_ref LIKE $1 AND is_available=TRUE) AS v1_available,
       (SELECT COUNT(*)::int FROM products WHERE product_ref LIKE $2) AS v2_total,
       (SELECT COUNT(*)::int FROM products WHERE product_ref LIKE $2 AND is_active=TRUE) AS v2_active,
       (SELECT COUNT(*)::int FROM products WHERE product_ref LIKE $2 AND is_available=TRUE) AS v2_available,
       (SELECT COUNT(*)::int FROM products WHERE product_ref LIKE $3 AND is_active=TRUE) AS golden_active,
       (SELECT COUNT(*)::int FROM products
          WHERE is_active=TRUE
            AND COALESCE(product_ref, '') NOT LIKE $1
            AND COALESCE(product_ref, '') NOT LIKE $2
            AND COALESCE(product_ref, '') NOT LIKE $3) AS other_active`,
    [V1_PATTERN, V2_PATTERN, GOLDEN_PATTERN],
  );
  return row;
}

async function retireShowcaseV1() {
  assertAuthorized();
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const before = await snapshot(client);

    const updated = await client.query(
      `UPDATE products
          SET is_active=FALSE,
              is_available=FALSE,
              updated_at=NOW()
        WHERE product_ref LIKE $1
          AND (is_active=TRUE OR is_available=TRUE)
      RETURNING id, product_ref`,
      [V1_PATTERN],
    );

    const after = await snapshot(client);

    if (after.v1_total !== before.v1_total) {
      throw new Error(`Invariant V1 total cassé: avant=${before.v1_total}, après=${after.v1_total}`);
    }
    if (after.v1_active !== 0 || after.v1_available !== 0) {
      throw new Error(`Retrait V1 incomplet: active=${after.v1_active}, available=${after.v1_available}`);
    }
    if (after.v2_total !== before.v2_total || after.v2_active !== before.v2_active || after.v2_available !== before.v2_available) {
      throw new Error(`Invariant V2 cassé: avant=${JSON.stringify(before)}, après=${JSON.stringify(after)}`);
    }
    if (after.golden_active !== before.golden_active) {
      throw new Error(`Invariant Golden cassé: avant=${before.golden_active}, après=${after.golden_active}`);
    }
    if (after.other_active !== before.other_active) {
      throw new Error(`Invariant autres produits cassé: avant=${before.other_active}, après=${after.other_active}`);
    }

    await client.query('COMMIT');
    const result = {
      before,
      updated: updated.rowCount,
      after,
      destructiveDeletes: 0,
    };
    console.log(`[showcase-v1-retire] ${JSON.stringify(result)}`);
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
    await retireShowcaseV1();
  } finally {
    await db.pool.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[showcase-v1-retire] échec:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  V1_PATTERN,
  V2_PATTERN,
  GOLDEN_PATTERN,
  assertAuthorized,
  snapshot,
  retireShowcaseV1,
};
