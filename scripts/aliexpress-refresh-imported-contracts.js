#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          aliexpress-authoritative-contract-refresh
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        DATABASE_URL, AliExpress managed credentials, --dry-run|--execute, --limit
 * @outputs       refreshed normalized_source_contract for existing imported AliExpress candidates
 * @depends       db.js, services/suppliers/connectors/aliexpress-connected-connector.js, services/suppliers/connectors/aliexpress-connector.js, services/suppliers/catalog-import-orchestrator.js
 * @used-by       audited staging one-shot operation before Supplier Order Identity replay
 * @db-read       sourcing_candidates, product_skus, supplier_oauth_connections
 * @db-write      supplier_catalog_imports, sourcing_candidates, sourcing_candidate_events, supplier_oauth_connections (token refresh only)
 * @db-txn        canonical import services own writes; advisory lock serializes refresh runs
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md, docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md
 * @impact-areas  catalog, sourcing, purchasing, staging
 * @version       2026-09-v1
 */
'use strict';

const db = require('../db');
const connected = require('../services/suppliers/connectors/aliexpress-connected-connector');
const baseConnector = require('../services/suppliers/connectors/aliexpress-connector');
const importer = require('../services/suppliers/catalog-import-orchestrator');

const SUPPLIER = 'AliExpress';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const BATCH_SIZE = 50;
const DEFAULT_COUNTRY_CODE = 'AE';
const LOCK_NAMESPACE = 'komerce';
const LOCK_KEY = 'aliexpress-authoritative-contract-refresh';

function parseArgs(argv = process.argv.slice(2)) {
  const execute = argv.includes('--execute');
  const dryRun = !execute;
  const limitArg = argv.find((arg) => arg.startsWith('--limit='));
  const limit = Number.parseInt(limitArg?.split('=')[1] || String(DEFAULT_LIMIT), 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`--limit doit être un entier 1..${MAX_LIMIT}`);
  }
  return { execute, dryRun, limit };
}

function assertRuntime({ execute }, env = process.env) {
  const runtime = String(env.KOMERCE_ENV || '').trim().toLowerCase();
  if (runtime !== 'staging') throw new Error(`REFUS: KOMERCE_ENV=staging requis (reçu: ${runtime || '<vide>'})`);
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  if (execute && env.KOMERCE_ALLOW_ALIEXPRESS_CONTRACT_REFRESH !== '1') {
    throw new Error('KOMERCE_ALLOW_ALIEXPRESS_CONTRACT_REFRESH=1 requis pour --execute');
  }
}

function countryCode(env = process.env) {
  const value = String(env.KOMERCE_ALIEXPRESS_COUNTRY_CODE || DEFAULT_COUNTRY_CODE).trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(value)) throw new Error('KOMERCE_ALIEXPRESS_COUNTRY_CODE doit être ISO alpha-2');
  return value;
}

function chunks(items, size = BATCH_SIZE) {
  const out = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

function identityUnits(product) {
  const units = Array.isArray(product?.sellable_units) ? product.sellable_units : [];
  return units.filter((unit) => unit?.supplier_unit_ref && unit?.supplier_order_identity);
}

function preserveDiscovery(product, existingRawPayload) {
  const discovery = existingRawPayload?.discovery || null;
  if (!discovery) return product;
  return {
    ...product,
    raw_payload: {
      ...(product.raw_payload || {}),
      discovery,
    },
  };
}

async function loadTargets(limit, queryable = db) {
  const { rows } = await queryable.query(
    `SELECT sc.id,
            sc.supplier_product_id,
            sc.product_id,
            sc.raw_payload
       FROM sourcing_candidates sc
      WHERE sc.supplier_name = $1
        AND sc.state = 'imported_to_catalog'
        AND sc.product_id IS NOT NULL
        AND sc.supplier_product_id IS NOT NULL
        AND EXISTS (
          SELECT 1
            FROM product_skus ps
           WHERE ps.product_id = sc.product_id
             AND ps.is_active = TRUE
             AND (ps.supplier_unit_ref IS NULL OR ps.supplier_order_identity IS NULL)
        )
      ORDER BY sc.created_at, sc.id
      LIMIT $2`,
    [SUPPLIER, limit]
  );
  return rows;
}

async function acquireLock() {
  const client = await db.getClient();
  const { rows: [row] } = await client.query(
    'SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked',
    [LOCK_NAMESPACE, LOCK_KEY]
  );
  if (!row?.locked) {
    client.release();
    return null;
  }
  return client;
}

async function releaseLock(client) {
  if (!client) return;
  try {
    await client.query('SELECT pg_advisory_unlock(hashtext($1), hashtext($2))', [LOCK_NAMESPACE, LOCK_KEY]);
  } finally {
    client.release();
  }
}

async function refreshBatch(batch, { execute, providerEnv, destinationCountry }) {
  const ids = batch.map((row) => row.supplier_product_id);
  const existingById = new Map(batch.map((row) => [String(row.supplier_product_id), row]));
  const fetched = await baseConnector.fetchProducts({
    productIds: ids,
    countryCode: destinationCountry,
    env: providerEnv,
  });

  const received = Array.isArray(fetched.products) ? fetched.products : [];
  const valid = received
    .map((product) => preserveDiscovery(product, existingById.get(String(product.supplier_product_id))?.raw_payload))
    .filter((product) => identityUnits(product).length > 0);
  const blocked = received.filter((product) => identityUnits(product).length === 0);
  const returnedIds = new Set(received.map((product) => String(product.supplier_product_id)));
  const notReturned = ids.filter((id) => !returnedIds.has(String(id)));

  let importResult = null;
  if (execute && valid.length) {
    importResult = await importer.importCatalog({
      supplier_name: SUPPLIER,
      source_type: 'api',
      source_filename: `aliexpress-authoritative-refresh/${Date.now()}.json`,
      notes: 'Authoritative targeted refresh of already imported AliExpress contracts for Supplier Order Identity.',
      is_full_snapshot: false,
    }, null, async () => ({ products: valid, invalid: [] }));
    if (importResult.status !== 200) {
      throw new Error(`Re-import autoritaire refusé: ${JSON.stringify(importResult.body)}`);
    }
  }

  return {
    requested: ids.length,
    returned: received.length,
    refreshable: valid.length,
    blocked_without_identity: blocked.length,
    invalid: Array.isArray(fetched.invalid) ? fetched.invalid.length : 0,
    not_returned: notReturned.length,
    sellable_units: valid.reduce((sum, product) => sum + (product.sellable_units?.length || 0), 0),
    identity_units: valid.reduce((sum, product) => sum + identityUnits(product).length, 0),
    imported: Number(importResult?.body?.accepted || 0),
    errors: Number(importResult?.body?.rejected || 0),
  };
}

function addSummary(total, part) {
  for (const key of Object.keys(total)) total[key] += Number(part[key] || 0);
}

async function main() {
  const args = parseArgs();
  assertRuntime(args);
  const targets = await loadTargets(args.limit);
  const output = {
    mode: args.dryRun ? 'dry-run' : 'execute',
    supplier: SUPPLIER,
    destination_country: countryCode(),
    targets: targets.length,
    requested: 0,
    returned: 0,
    refreshable: 0,
    blocked_without_identity: 0,
    invalid: 0,
    not_returned: 0,
    sellable_units: 0,
    identity_units: 0,
    imported: 0,
    errors: 0,
  };

  if (!targets.length) {
    console.log(`[aliexpress-contract-refresh] ${JSON.stringify(output)}`);
    return output;
  }

  const lock = await acquireLock();
  if (!lock) throw new Error('REFUS: un refresh autoritaire AliExpress est déjà actif');
  try {
    const providerEnv = await connected.managedRuntimeEnv();
    for (const batch of chunks(targets)) {
      const result = await refreshBatch(batch, {
        execute: args.execute,
        providerEnv,
        destinationCountry: output.destination_country,
      });
      addSummary(output, result);
      console.log(`[aliexpress-contract-refresh] batch ${JSON.stringify(result)}`);
    }
  } finally {
    await releaseLock(lock);
  }

  console.log(`[aliexpress-contract-refresh] ${JSON.stringify(output)}`);
  return output;
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`[aliexpress-contract-refresh] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  SUPPLIER,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  BATCH_SIZE,
  DEFAULT_COUNTRY_CODE,
  parseArgs,
  assertRuntime,
  countryCode,
  chunks,
  identityUnits,
  preserveDiscovery,
  loadTargets,
  refreshBatch,
  main,
};
