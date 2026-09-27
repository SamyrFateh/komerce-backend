#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          catalog-batch-french-preparation
 * @domain        catalog
 * @layer         tooling
 * @criticality   medium
 * @inputs        DATABASE_URL
 * @outputs       traced manual French preparation for inactive supplier drafts
 * @depends       db.js, scripts/catalog-fr-free-e2e-preparation.js
 * @used-by       staging catalog ops
 * @db-read       products, sourcing_candidates
 * @db-write-via  services/catalog-overrides.js through catalog-fr-free-e2e-preparation.js
 * @db-txn        canonical override writes
 * @doctrine      no_paid_ai_api, source_preserved, staging_e2e_fixture_only
 * @impact-areas  catalog
 * @version       2026-09-v2
 */
'use strict';

const db = require('../db');
const freePreparation = require('./catalog-fr-free-e2e-preparation');

const SUPPLIER_NAME = 'AliExpress';
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;

function parseArgs(argv = process.argv.slice(2)) {
  let mode = 'dry-run';
  let limit = DEFAULT_LIMIT;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') mode = 'dry-run';
    else if (arg === '--execute') mode = 'execute';
    else if (arg === '--limit') limit = Number.parseInt(argv[++i], 10);
    else if (arg.startsWith('--limit=')) limit = Number.parseInt(arg.split('=', 2)[1], 10);
    else if (arg === '--concurrency' || arg.startsWith('--concurrency=')) {
      if (arg === '--concurrency') i += 1; // retained for backward CLI compatibility; unused.
    } else throw new Error(`Argument inconnu: ${arg}`);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`--limit doit être un entier entre 1 et ${MAX_LIMIT}`);
  }
  return { mode, limit };
}

async function eligible(limit) {
  const { rows } = await db.query(
    `SELECT p.id, p.product_ref, p.name, p.source_locale, p.content_source
       FROM products p
       JOIN sourcing_candidates sc ON sc.product_id=p.id
      WHERE sc.supplier_name=$1
        AND sc.state='imported_to_catalog'
        AND p.lifecycle_status='candidate'
        AND p.is_active=FALSE
        AND p.content_source='connector_raw'
        AND p.source_locale IS NOT NULL
        AND lower(p.source_locale) NOT LIKE 'fr%'
      ORDER BY p.product_ref
      LIMIT $2`,
    [SUPPLIER_NAME, limit]
  );
  return rows;
}

async function main() {
  const { mode, limit } = parseArgs();
  freePreparation.assertRuntime();

  const rows = await eligible(limit);
  console.log(`[batch-fr-free] supplier=${SUPPLIER_NAME} mode=${mode} eligible=${rows.length} api_calls=0`);

  if (mode === 'dry-run') {
    for (const row of rows.slice(0, 10)) {
      console.log(`  ${row.product_ref} ${row.source_locale} ${String(row.name || '').slice(0, 60)}`);
    }
    return { eligible: rows.length, api_calls: 0, paid_ai_dependency: false };
  }

  const result = await freePreparation.run({
    limit,
    output: null,
    suppliers: [SUPPLIER_NAME],
  });
  console.log(`[batch-fr-free] prepared=${result.summary.prepared} failed=${result.summary.failed} api_calls=0`);
  return result.summary;
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`[batch-fr-free] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = { SUPPLIER_NAME, DEFAULT_LIMIT, MAX_LIMIT, parseArgs, eligible, main };
