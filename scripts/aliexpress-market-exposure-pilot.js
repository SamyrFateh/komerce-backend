#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          aliexpress-market-exposure-pilot
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        staging runtime, exact five AliExpress pilot refs, KM market
 * @outputs       audited product_market_exposure decisions for exact pilot only
 * @depends       db.js, services/catalog-market-exposure-service.js, services/market-delegation-service.js
 * @used-by       scripts/aliexpress-prepayment-proof.js Railway one-shot router
 * @db-read       products, product_skus, markets, product_market_exposure
 * @db-write-via:catalog-market-exposure-service product_market_exposure
 * @db-write-via:market-delegation-service market_delegation_audit
 * @db-txn        single atomic transaction for exact pilot
 * @doctrine      catalog_stays_unique_exposure_is_projection, missing_exposure_is_disabled
 * @impact-areas  catalog, market-delegation, boutique, staging
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const exposureService = require('../services/catalog-market-exposure-service');
const { audit } = require('../services/market-delegation-service');

const MARKET_CODE = 'KM';
const PILOT_REFS = Object.freeze([
  'KPR-131413',
  'KPR-131414',
  'KPR-131415',
  'KPR-131416',
  'KPR-131417',
]);
const WRITE_GUARD = 'KOMERCE_ALLOW_ALIEXPRESS_MARKET_EXPOSURE';

function assertStaging(env = process.env) {
  const runtime = String(env.KOMERCE_ENV || '').trim().toLowerCase();
  if (runtime !== 'staging') {
    throw new Error(`REFUS: KOMERCE_ENV=staging requis (reçu: ${runtime || '<vide>'})`);
  }
}

function parseArgs(argv = process.argv.slice(2)) {
  let mode = 'dry-run';
  for (const arg of argv) {
    if (arg === '--dry-run') mode = 'dry-run';
    else if (arg === '--execute') mode = 'execute';
    else if (arg === '--limit=5' || arg === '--limit' || arg === '5') {
      // Compatibilité avec le routeur one-shot : le pilote est volontairement
      // figé à cinq références et refuse implicitement tout autre périmètre.
    } else if (arg.startsWith('--limit=')) {
      throw new Error('REFUS: le pilote exposure est figé à --limit=5');
    } else {
      throw new Error(`Argument inconnu: ${arg}`);
    }
  }
  return { mode };
}

async function loadPilot(executor) {
  const { rows } = await executor.query(
    `SELECT p.id,
            p.product_ref,
            p.name,
            p.is_active,
            p.quality_validated,
            p.needs_review,
            p.is_available,
            p.image_url,
            COUNT(ps.id) FILTER (WHERE ps.source = 'SUPPLIER')::int AS supplier_skus,
            COUNT(ps.id) FILTER (
              WHERE ps.source = 'SUPPLIER'
                AND ps.supplier_unit_ref IS NOT NULL
                AND ps.supplier_order_identity IS NOT NULL
            )::int AS supplier_skus_with_soi
       FROM products p
       LEFT JOIN product_skus ps ON ps.product_id = p.id
      WHERE p.product_ref = ANY($1::text[])
      GROUP BY p.id, p.product_ref, p.name, p.is_active, p.quality_validated,
               p.needs_review, p.is_available, p.image_url
      ORDER BY p.product_ref`,
    [PILOT_REFS]
  );
  return rows;
}

function assertPilotReady(rows) {
  if (rows.length !== PILOT_REFS.length) {
    const got = new Set(rows.map(row => row.product_ref));
    const missing = PILOT_REFS.filter(ref => !got.has(ref));
    throw new Error(`REFUS: pilote incomplet — refs manquantes: ${missing.join(', ') || '<aucune>'}`);
  }

  for (const row of rows) {
    if (row.is_active !== true) throw new Error(`REFUS ${row.product_ref}: is_active != true`);
    if (row.quality_validated !== true) throw new Error(`REFUS ${row.product_ref}: quality_validated != true`);
    if (row.needs_review === true) throw new Error(`REFUS ${row.product_ref}: needs_review=true`);
    if (!row.image_url || !/^https:\/\//i.test(row.image_url)) throw new Error(`REFUS ${row.product_ref}: hero HTTPS manquant`);
    if (row.supplier_skus < 1) throw new Error(`REFUS ${row.product_ref}: aucun SKU fournisseur`);
    if (row.supplier_skus_with_soi !== row.supplier_skus) {
      throw new Error(`REFUS ${row.product_ref}: SOI ${row.supplier_skus_with_soi}/${row.supplier_skus}`);
    }
  }
}

async function resolveMarket(executor) {
  const { rows } = await executor.query(
    'SELECT id, code FROM markets WHERE code = $1 LIMIT 1',
    [MARKET_CODE]
  );
  if (rows.length !== 1) throw new Error(`REFUS: marché ${MARKET_CODE} introuvable`);
  return rows[0];
}

async function snapshot(executor, products, marketId) {
  const result = [];
  for (const product of products) {
    const exposure = await exposureService.getExposure(product.id, marketId, executor);
    result.push({
      product_ref: product.product_ref,
      product_id: product.id,
      name: product.name,
      exposure,
      supplier_skus: product.supplier_skus,
      supplier_skus_with_soi: product.supplier_skus_with_soi,
    });
  }
  return result;
}

async function run({ mode = 'dry-run', env = process.env } = {}) {
  assertStaging(env);
  if (mode !== 'dry-run' && mode !== 'execute') throw new Error(`mode invalide: ${mode}`);
  if (mode === 'execute' && env[WRITE_GUARD] !== '1') {
    throw new Error(`${WRITE_GUARD}=1 requis pour execute`);
  }

  const products = await loadPilot(db);
  assertPilotReady(products);
  const market = await resolveMarket(db);
  const before = await snapshot(db, products, market.id);

  console.log(`[aliexpress-market-exposure] mode=${mode} market=${MARKET_CODE} refs=${PILOT_REFS.length}`);
  console.log(`[aliexpress-market-exposure] before=${JSON.stringify(before)}`);

  if (mode === 'dry-run') {
    return { mode, market: MARKET_CODE, before, after: before };
  }

  const client = await db.getClient();
  const correlationId = `staging-aliexpress-km-pilot-${Date.now()}`;
  try {
    await client.query('BEGIN');
    for (const product of products) {
      const previous = await exposureService.getExposure(product.id, market.id, client);
      if (previous === exposureService.EXPOSURE.ENABLED) continue;

      const after = await exposureService.setExposure(
        product.id,
        market.id,
        exposureService.EXPOSURE.ENABLED,
        null,
        client
      );

      await audit(client, {
        actorUserId: null,
        assignmentId: null,
        membershipId: null,
        capability: 'catalog.expose',
        action: 'CATALOG_PRODUCT_EXPOSED_STAGING_PILOT',
        before: { product_ref: product.product_ref, market_code: MARKET_CODE, commercial_exposure: previous },
        after: { ...after, product_ref: product.product_ref, market_code: MARKET_CODE, source: 'staging-aliexpress-pilot' },
        correlationId,
      });
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const after = await snapshot(db, products, market.id);
  const blocked = after.filter(row => row.exposure !== exposureService.EXPOSURE.ENABLED);
  if (blocked.length) {
    throw new Error(`POSTCHECK FAILED: ${blocked.map(row => `${row.product_ref}:${row.exposure}`).join(', ')}`);
  }

  console.log(`[aliexpress-market-exposure] after=${JSON.stringify(after)}`);
  console.log(`[aliexpress-market-exposure] ENABLED ${after.length}/${PILOT_REFS.length} on ${MARKET_CODE}`);
  return { mode, market: MARKET_CODE, before, after, correlationId };
}

async function main() {
  const { mode } = parseArgs();
  await run({ mode });
}

if (require.main === module) {
  main()
    .catch(error => {
      console.error(`[aliexpress-market-exposure] FAILED: ${error.stack || error}`);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = {
  MARKET_CODE,
  PILOT_REFS,
  WRITE_GUARD,
  assertStaging,
  parseArgs,
  assertPilotReady,
  run,
};
