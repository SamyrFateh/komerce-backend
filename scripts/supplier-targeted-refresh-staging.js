#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          supplier-targeted-refresh-staging
 * @domain        sourcing
 * @layer         script
 * @criticality   high
 * @inputs        supplier_id, limit, staging supplier credentials, sourcing candidates
 * @outputs       canonical candidate refresh through catalog-import-orchestrator
 * @depends       db.js, services/sourcing-import-dispatch.js, services/suppliers/catalog-import-orchestrator.js
 * @db-read       sourcing_candidates
 * @db-write      supplier_catalog_imports, sourcing_candidates (execute mode only via canonical orchestrator)
 * @db-txn        orchestrator_owned
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md, docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md
 * @impact-areas  sourcing, supplier-integration, catalog
 * @version       2026-09-v1
 */
'use strict';

const db = require('../db');
const importDispatch = require('../services/sourcing-import-dispatch');
const importer = require('../services/suppliers/catalog-import-orchestrator');

const EXECUTE_FLAG = 'KOMERCE_ALLOW_SUPPLIER_TARGETED_REFRESH';
const MAX_LIMIT = 20;

function truthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function runtime(env = process.env) {
  return String(env.KOMERCE_ENV || env.NODE_ENV || '').trim().toLowerCase() || 'unknown';
}

function parseArgs(argv = process.argv.slice(2)) {
  const out = { supplierId: null, limit: 5, execute: false };
  for (const arg of argv) {
    if (arg === '--execute') out.execute = true;
    else if (arg.startsWith('--supplier=')) out.supplierId = arg.slice('--supplier='.length).trim().toLowerCase();
    else if (arg.startsWith('--limit=')) out.limit = Number.parseInt(arg.slice('--limit='.length), 10);
  }
  if (!out.supplierId) throw new Error('--supplier=<api supplier id> requis');
  if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > MAX_LIMIT) {
    throw new Error(`--limit doit être compris entre 1 et ${MAX_LIMIT}`);
  }
  return out;
}

function supplierEntry(supplierId) {
  const entry = importDispatch.CONNECTORS.api[supplierId];
  if (!entry) throw new Error(`Fournisseur API inconnu: ${supplierId}`);
  if (!entry.module || typeof entry.module.fetchProducts !== 'function') {
    throw new Error(`Connecteur ${supplierId} sans fetchProducts()`);
  }
  const supplierName = String(entry.module.SUPPLIER_NAME || '').trim();
  if (!supplierName) throw new Error(`Connecteur ${supplierId} sans SUPPLIER_NAME canonique`);
  return { entry, supplierName };
}

function assertExecuteAllowed(options, env = process.env) {
  if (!options.execute) return;
  const rt = runtime(env);
  if (rt === 'production') throw new Error('REFUS: targeted supplier refresh interdit en production');
  if (!truthy(env[EXECUTE_FLAG])) throw new Error(`${EXECUTE_FLAG}=1 requis avec --execute`);
}

async function selectCandidates(supplierName, limit) {
  const { rows } = await db.query(
    `SELECT id, supplier_product_id, product_name, scan_result,
            normalized_source_contract, created_at
       FROM sourcing_candidates
      WHERE state = 'scanned'
        AND product_id IS NULL
        AND supplier_name = $1
        AND supplier_product_id IS NOT NULL
        AND normalized_source_contract IS NOT NULL
      ORDER BY
        CASE WHEN COALESCE((normalized_source_contract->>'stock_available')::numeric, 0) > 0 THEN 0 ELSE 1 END,
        created_at DESC
      LIMIT $2`,
    [supplierName, limit]
  );
  return rows;
}

function summarizeBefore(rows) {
  return rows.map((row) => ({
    candidate_id: row.id,
    supplier_product_id: String(row.supplier_product_id),
    name: row.product_name,
    stock: Number(row.normalized_source_contract?.stock_available || 0),
    decision: row.scan_result?.sourcing_decision || null,
    test_price_kmf: row.scan_result?.test_price_kmf || null,
    authority: row.scan_result?.recommended_price_authority || row.scan_result?.price_authority || null,
  }));
}

function summarizeAfter(rows) {
  return rows.map((row) => {
    const contract = row.normalized_source_contract || {};
    const units = Array.isArray(contract.sellable_units) ? contract.sellable_units : [];
    const active = units.filter((unit) => unit && unit.is_active !== false && Number(unit.stock_available) > 0);
    const complete = active.filter((unit) => (
      unit.supplier_sku
      && unit.supplier_unit_ref
      && unit.supplier_order_identity?.provider
      && unit.supplier_order_identity?.payload
      && Object.keys(unit.supplier_order_identity.payload).length > 0
    ));
    return {
      candidate_id: row.id,
      supplier_product_id: String(row.supplier_product_id),
      state: row.state,
      product_id: row.product_id || null,
      decision: row.scan_result?.sourcing_decision || null,
      test_price_kmf: row.scan_result?.test_price_kmf || null,
      authority: row.scan_result?.recommended_price_authority || row.scan_result?.price_authority || null,
      stock: Number(contract.stock_available || 0),
      units: units.length,
      active_units: active.length,
      complete_soi_units: complete.length,
      all_active_units_have_soi: active.length > 0 && complete.length === active.length,
    };
  });
}

async function loadAfter(supplierName, productIds) {
  const { rows } = await db.query(
    `SELECT id, supplier_product_id, product_name, state, product_id,
            scan_result, normalized_source_contract
       FROM sourcing_candidates
      WHERE supplier_name = $1
        AND supplier_product_id = ANY($2::text[])
      ORDER BY supplier_product_id`,
    [supplierName, productIds]
  );
  return rows;
}

async function run(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);
  assertExecuteAllowed(options, env);
  const { supplierName } = supplierEntry(options.supplierId);
  const selected = await selectCandidates(supplierName, options.limit);
  const productIds = selected.map((row) => String(row.supplier_product_id));
  const before = summarizeBefore(selected);

  if (!options.execute) {
    const out = {
      mode: 'dry-run',
      runtime: runtime(env),
      writes: false,
      supplier_id: options.supplierId,
      supplier_name: supplierName,
      selected_count: selected.length,
      product_ids: productIds,
      candidates: before,
      next_gate: selected.length ? `rerun with --execute and ${EXECUTE_FLAG}=1` : 'NO_CANDIDATES',
    };
    console.log(`[supplier-targeted-refresh] ${JSON.stringify(out)}`);
    return out;
  }

  if (!productIds.length) throw new Error(`Aucun candidat ${supplierName} à rafraîchir`);

  const result = await importer.importCatalog({
    supplier_name: supplierName,
    supplier_id: options.supplierId,
    source_type: 'api',
    product_ids: productIds,
    notes: `targeted canonical supplier refresh (${options.supplierId}, ${productIds.length})`,
  }, null, importDispatch.dispatchToConnector);

  if (result.status >= 400) {
    throw new Error(`Import canonique refusé: ${JSON.stringify(result.body)}`);
  }

  const afterRows = await loadAfter(supplierName, productIds);
  const after = summarizeAfter(afterRows);
  const out = {
    mode: 'execute',
    runtime: runtime(env),
    writes: true,
    supplier_id: options.supplierId,
    supplier_name: supplierName,
    product_ids: productIds,
    before,
    import_result: result.body,
    after,
    publication: 'NOT_PERFORMED',
    market_exposure: 'NOT_PERFORMED',
    place_order: 'HARD_STOP',
  };
  console.log(`[supplier-targeted-refresh] ${JSON.stringify(out)}`);
  return out;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(`[supplier-targeted-refresh] FAILED: ${error.stack || error}`);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = {
  EXECUTE_FLAG,
  MAX_LIMIT,
  truthy,
  runtime,
  parseArgs,
  supplierEntry,
  assertExecuteAllowed,
  summarizeBefore,
  summarizeAfter,
  run,
};
