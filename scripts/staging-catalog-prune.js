#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-local-catalog-prune
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        DATABASE_URL, KOMERCE_ENV=staging, --dry-run|--execute
 * @outputs       staging transaction purge + active catalog reduced to Golden + valid CJ local stock
 * @depends       db.js
 * @used-by       explicit local staging maintenance only
 * @db-read       markets, products, local_stock, sourcing_candidates, orders
 * @db-write      orders, basket_items, baskets, recipients, local_stock, product_market_exposure, products
 * @db-txn        all destructive mutations in one PostgreSQL transaction
 * @doctrine      staging_only, fail_closed, deactivate_not_delete, preserve_sourcing_sas
 * @impact-areas  staging-catalog, discovery, orders, local-stock
 * @version       2026-09-v1
 */
'use strict';

const db = require('../db');

const MARKET_CODE = 'KM';
const LOCATION = 'KM_MAIN';
const GOLDEN_REF = 'GOLDEN-ELITE-PRO';
const CJ_SOURCE = 'CJdropshipping';
const ALIEXPRESS_SUPPLIER = 'AliExpress';
const EXPECTED_ALIEXPRESS_CLEAN = 500;
const LOCK_NAMESPACE = 'komerce';
const LOCK_KEY = 'staging-catalog-prune';

const SESSION_TABLES = Object.freeze(['basket_items', 'baskets', 'recipients']);

function modeFromArgv(argv = process.argv.slice(2)) {
  const execute = argv.includes('--execute');
  const dryRun = argv.includes('--dry-run');
  if (execute && dryRun) throw new Error('Choisir soit --dry-run soit --execute, pas les deux');
  return execute ? 'execute' : 'dry-run';
}

function runtimeEnvironment(env = process.env) {
  return String(env.KOMERCE_ENV || '').trim().toLowerCase();
}

function assertRuntime(mode, env = process.env) {
  const runtime = runtimeEnvironment(env);
  if (runtime !== 'staging') {
    throw new Error(`REFUS: KOMERCE_ENV=staging requis (reçu: ${runtime || '<vide>'})`);
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  if (!['dry-run', 'execute'].includes(mode)) throw new Error(`Mode invalide: ${mode}`);
}

function cleanStockSql(alias = 'sc') {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`Alias SQL invalide: ${alias}`);
  return `(
    ${alias}.normalized_source_contract ? 'stock_available'
    AND (${alias}.normalized_source_contract->>'stock_available') ~ '^[0-9]+([.][0-9]+)?$'
    AND (${alias}.normalized_source_contract->>'stock_available')::numeric > 0
  )`;
}

async function countCleanAliExpress(queryable = db) {
  const { rows: [row] } = await queryable.query(
    `SELECT COUNT(*)::int AS count
       FROM sourcing_candidates sc
      WHERE sc.supplier_name = $1
        AND sc.supplier_product_id IS NOT NULL
        AND sc.state IN ('scanned', 'imported_to_catalog')
        AND COALESCE(sc.product_name, '') <> ''
        AND sc.image_url ~ '^https://'
        AND sc.purchase_price IS NOT NULL
        AND sc.purchase_price > 0
        AND ${cleanStockSql('sc')}`,
    [ALIEXPRESS_SUPPLIER]
  );
  return Number(row?.count || 0);
}

async function resolveMarket(queryable = db) {
  const { rows: [market] } = await queryable.query(
    `SELECT id, code
       FROM markets
      WHERE code = $1
        AND is_active = TRUE
      LIMIT 1`,
    [MARKET_CODE]
  );
  if (!market) throw new Error(`Marché ${MARKET_CODE} actif introuvable`);
  return market;
}

async function loadKeepProducts(queryable, marketId) {
  const { rows } = await queryable.query(
    `SELECT DISTINCT
            p.id,
            p.product_ref,
            p.name,
            p.sourcing_source,
            p.category,
            p.subcategory,
            p.image_url,
            p.is_active,
            p.is_available,
            ls.qty_physical,
            ls.commercial_exposure
       FROM products p
       LEFT JOIN local_stock ls
         ON ls.product_id = p.id
        AND ls.market_id = $1
        AND ls.location = $2
      WHERE p.product_ref = $3
         OR (
              p.sourcing_source = $4
          AND p.is_active = TRUE
          AND p.is_available = TRUE
          AND p.image_url ~ '^https://'
          AND p.product_ref NOT LIKE 'SHOWCASE-V1-%'
          AND p.product_ref NOT LIKE 'SHOWCASE-V2-%'
          AND ls.commercial_exposure = 'ENABLED'
          AND COALESCE(ls.qty_physical, 0) > 0
         )
      ORDER BY p.product_ref`,
    [marketId, LOCATION, GOLDEN_REF, CJ_SOURCE]
  );

  const golden = rows.filter(row => row.product_ref === GOLDEN_REF);
  if (golden.length !== 1) {
    throw new Error(`Golden Product attendu exactement 1 fois, trouvé ${golden.length}`);
  }

  const cj = rows.filter(row => row.sourcing_source === CJ_SOURCE);
  if (cj.length < 1) {
    throw new Error('REFUS: aucun produit CJ local valide détecté');
  }

  return rows;
}

async function auditState(queryable = db) {
  const market = await resolveMarket(queryable);
  const keepProducts = await loadKeepProducts(queryable, market.id);
  const keepIds = keepProducts.map(row => row.id);
  const aliExpressClean = await countCleanAliExpress(queryable);

  const { rows: [counts] } = await queryable.query(
    `SELECT
       (SELECT COUNT(*)::int FROM products) AS products_total,
       (SELECT COUNT(*)::int FROM products WHERE is_active = TRUE) AS products_active,
       (SELECT COUNT(*)::int FROM products WHERE product_ref LIKE 'SHOWCASE-V1-%') AS showcase_v1_total,
       (SELECT COUNT(*)::int FROM products WHERE product_ref LIKE 'SHOWCASE-V2-%') AS showcase_v2_total,
       (SELECT COUNT(*)::int FROM products WHERE is_active = TRUE AND product_ref LIKE 'SHOWCASE-V1-%') AS showcase_v1_active,
       (SELECT COUNT(*)::int FROM products WHERE is_active = TRUE AND product_ref LIKE 'SHOWCASE-V2-%') AS showcase_v2_active,
       (SELECT COUNT(*)::int FROM orders) AS orders_total,
       (SELECT COUNT(*)::int FROM local_stock WHERE market_id = $1 AND location = $2) AS local_stock_rows`,
    [market.id, LOCATION]
  );

  const { rows: legacyProducts } = await queryable.query(
    `SELECT id, product_ref, name, sourcing_source, is_active, is_available
       FROM products
      WHERE NOT (id = ANY($1::uuid[]))
      ORDER BY is_active DESC, sourcing_source NULLS LAST, product_ref`,
    [keepIds]
  );

  const bySource = {};
  for (const row of legacyProducts) {
    const key = row.sourcing_source || '<null>';
    bySource[key] = (bySource[key] || 0) + 1;
  }

  return {
    runtime: runtimeEnvironment(),
    market: market.code,
    location: LOCATION,
    aliexpress_clean: aliExpressClean,
    aliexpress_target: EXPECTED_ALIEXPRESS_CLEAN,
    keep: {
      total: keepProducts.length,
      cj: keepProducts.filter(row => row.sourcing_source === CJ_SOURCE).length,
      golden: keepProducts.filter(row => row.product_ref === GOLDEN_REF).length,
      refs: keepProducts.map(row => row.product_ref),
    },
    counts,
    legacy: {
      total: legacyProducts.length,
      active: legacyProducts.filter(row => row.is_active).length,
      by_source: bySource,
      refs: legacyProducts.map(row => row.product_ref),
    },
    keepProducts,
    keepIds,
  };
}

function printableAudit(audit, mode) {
  return {
    mode,
    runtime: audit.runtime,
    market: audit.market,
    location: audit.location,
    aliexpress_clean: `${audit.aliexpress_clean}/${audit.aliexpress_target}`,
    keep: audit.keep,
    counts: audit.counts,
    legacy: {
      total: audit.legacy.total,
      active: audit.legacy.active,
      by_source: audit.legacy.by_source,
      refs: audit.legacy.refs,
    },
  };
}

async function deleteIfTableExists(client, tableName) {
  if (!SESSION_TABLES.includes(tableName)) throw new Error(`Table non autorisée: ${tableName}`);
  const { rows: [exists] } = await client.query('SELECT to_regclass($1) IS NOT NULL AS ok', [`public.${tableName}`]);
  if (!exists?.ok) return { table: tableName, deleted: 0, missing: true };
  const result = await client.query(`DELETE FROM ${tableName}`); // safe: hard-coded allowlist only
  return { table: tableName, deleted: result.rowCount, missing: false };
}

async function executePrune(before) {
  if (before.aliexpress_clean !== EXPECTED_ALIEXPRESS_CLEAN) {
    throw new Error(`REFUS: pool AliExpress attendu ${EXPECTED_ALIEXPRESS_CLEAN}, trouvé ${before.aliexpress_clean}`);
  }

  const client = await db.getClient();
  let locked = false;
  try {
    const { rows: [lock] } = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked',
      [LOCK_NAMESPACE, LOCK_KEY]
    );
    if (!lock?.locked) throw new Error('REFUS: un autre prune staging est déjà actif');
    locked = true;

    await client.query('BEGIN');

    const inside = await auditState(client);
    if (inside.aliexpress_clean !== EXPECTED_ALIEXPRESS_CLEAN) {
      throw new Error(`REFUS transaction: AliExpress ${inside.aliexpress_clean}/${EXPECTED_ALIEXPRESS_CLEAN}`);
    }

    const beforeKeep = [...before.keepIds].sort();
    const insideKeep = [...inside.keepIds].sort();
    if (JSON.stringify(beforeKeep) !== JSON.stringify(insideKeep)) {
      throw new Error('REFUS transaction: keep-list modifiée entre audit et exécution');
    }

    // Staging transaction history is intentionally disposable. TRUNCATE ... CASCADE
    // clears orders and every FK-dependent transactional table atomically.
    const orderCount = inside.counts.orders_total;
    await client.query('TRUNCATE TABLE orders CASCADE');

    const sessionCleanup = [];
    for (const table of SESSION_TABLES) {
      sessionCleanup.push(await deleteIfTableExists(client, table));
    }

    const keepIds = inside.keepIds;

    const localStockRemoved = await client.query(
      `DELETE FROM local_stock
        WHERE NOT (product_id = ANY($1::uuid[]))`,
      [keepIds]
    );

    const exposureRemoved = await client.query(
      `DELETE FROM product_market_exposure
        WHERE NOT (product_id = ANY($1::uuid[]))`,
      [keepIds]
    );

    const deactivated = await client.query(
      `UPDATE products
          SET is_active = FALSE,
              is_available = FALSE,
              updated_at = NOW()
        WHERE NOT (id = ANY($1::uuid[]))
          AND (is_active = TRUE OR is_available = TRUE)
      RETURNING id, product_ref, sourcing_source`,
      [keepIds]
    );

    const { rows: [verification] } = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM orders) AS orders_total,
         (SELECT COUNT(*)::int FROM products WHERE is_active = TRUE AND NOT (id = ANY($1::uuid[]))) AS unexpected_active,
         (SELECT COUNT(*)::int FROM products WHERE is_active = TRUE AND product_ref LIKE 'SHOWCASE-V1-%') AS showcase_v1_active,
         (SELECT COUNT(*)::int FROM products WHERE is_active = TRUE AND product_ref LIKE 'SHOWCASE-V2-%') AS showcase_v2_active,
         (SELECT COUNT(*)::int FROM local_stock WHERE NOT (product_id = ANY($1::uuid[]))) AS unexpected_local_stock,
         (SELECT COUNT(*)::int FROM product_market_exposure WHERE NOT (product_id = ANY($1::uuid[]))) AS unexpected_exposure`,
      [keepIds]
    );

    const aliExpressAfter = await countCleanAliExpress(client);
    if (aliExpressAfter !== EXPECTED_ALIEXPRESS_CLEAN) {
      throw new Error(`REFUS commit: AliExpress a dérivé ${aliExpressAfter}/${EXPECTED_ALIEXPRESS_CLEAN}`);
    }
    if (verification.orders_total !== 0
        || verification.unexpected_active !== 0
        || verification.showcase_v1_active !== 0
        || verification.showcase_v2_active !== 0
        || verification.unexpected_local_stock !== 0
        || verification.unexpected_exposure !== 0) {
      throw new Error(`REFUS commit: audit final invalide ${JSON.stringify(verification)}`);
    }

    await client.query('COMMIT');

    return {
      orders_removed: orderCount,
      session_cleanup: sessionCleanup,
      local_stock_removed: localStockRemoved.rowCount,
      market_exposure_removed: exposureRemoved.rowCount,
      products_deactivated: deactivated.rowCount,
      deactivated_refs: deactivated.rows.map(row => row.product_ref),
      aliexpress_clean_after: aliExpressAfter,
      verification,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (locked) {
      await client.query(
        'SELECT pg_advisory_unlock(hashtext($1), hashtext($2))',
        [LOCK_NAMESPACE, LOCK_KEY]
      ).catch(() => {});
    }
    client.release();
  }
}

async function main() {
  const mode = modeFromArgv();
  assertRuntime(mode);

  const before = await auditState();
  console.log(`[staging-catalog-prune] AUDIT ${JSON.stringify(printableAudit(before, mode), null, 2)}`);

  if (mode === 'dry-run') {
    console.log('[staging-catalog-prune] DRY_RUN aucun changement écrit');
    return { mode, before };
  }

  const result = await executePrune(before);
  const after = await auditState();

  console.log(`[staging-catalog-prune] EXECUTED ${JSON.stringify(result, null, 2)}`);
  console.log(`[staging-catalog-prune] FINAL ${JSON.stringify(printableAudit(after, mode), null, 2)}`);
  return { mode, before, result, after };
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(`[staging-catalog-prune] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  MARKET_CODE,
  LOCATION,
  GOLDEN_REF,
  CJ_SOURCE,
  ALIEXPRESS_SUPPLIER,
  EXPECTED_ALIEXPRESS_CLEAN,
  SESSION_TABLES,
  modeFromArgv,
  runtimeEnvironment,
  assertRuntime,
  cleanStockSql,
  countCleanAliExpress,
  resolveMarket,
  loadKeepProducts,
  auditState,
  printableAudit,
  executePrune,
  main,
};
