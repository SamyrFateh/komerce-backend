#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          aliexpress-golden-existing-repair
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        exact existing Golden supplier_product_id, live AliExpress source, staging DB
 * @outputs       read-only repair proof or canonical candidate re-import plus semantic stop/pass evidence
 * @depends       db.js, scripts/aliexpress-golden-e2e-core.js, scripts/aliexpress-golden-semantic.js, services/suppliers/catalog-import-orchestrator.js, services/supplier-catalog-scanner.js
 * @used-by       staging one-shot only
 * @db-read       sourcing_candidates
 * @db-write-via:catalog-import-orchestrator supplier_catalog_imports, sourcing_candidates, sourcing_candidate_events
 * @db-txn        canonical import owner
 * @impact-areas  sourcing, catalog, supplier-integration, staging
 * @version       2026-09-golden-repair-v2
 */
'use strict';

const db = require('../db');
const connected = require('../services/suppliers/connectors/aliexpress-connected-connector');
const catalogImportOrchestrator = require('../services/suppliers/catalog-import-orchestrator');
const scanner = require('../services/supplier-catalog-scanner');
const pool = require('./aliexpress-500-catalog-sync');
const golden = require('./aliexpress-golden-e2e-core');
const semantic = require('./aliexpress-golden-semantic');

function parseSupplierProductId(argv = process.argv.slice(2)) {
  const arg = argv.find((item) => item.startsWith('--supplier-product-id='));
  const id = arg ? arg.slice('--supplier-product-id='.length).trim() : '';
  if (!/^\d{5,20}$/.test(id)) throw new Error('--supplier-product-id=<id AliExpress exact> requis');
  return id;
}

function parseMode(argv = process.argv.slice(2)) {
  return argv.includes('--dry-run') ? 'dry-run' : 'execute';
}

async function readExisting(id) {
  const { rows: [row] } = await db.query(
    `SELECT id, state, product_id, supplier_product_id, product_name,
            komerce_category, scan_result, raw_payload, normalized_source_contract
       FROM sourcing_candidates
      WHERE supplier_name = 'AliExpress' AND supplier_product_id = $1
      ORDER BY updated_at DESC LIMIT 1`,
    [id]
  );
  return row || null;
}

async function loadLiveContext(id, before, env) {
  const baseConfig = golden.discoveryConfig(env);
  const originalQuery = String(before.raw_payload?.discovery?.query || baseConfig.query || '').trim();
  const config = { ...baseConfig, query: originalQuery };
  const providerEnv = await connected.managedRuntimeEnv({ env });
  const fetched = await pool.fetchProductsRateLimited([id], {
    countryCode: config.countryCode,
    providerEnv,
    detailDelayMs: 0,
    detailRetryAttempts: pool.DEFAULT_DETAIL_RETRY_ATTEMPTS,
  });
  const live = (fetched.products || []).find((product) => String(product.supplier_product_id) === id);
  if (!live) throw new Error(`AliExpress live n'a pas renvoyé ${id}`);
  if (!golden.sourceQualified(live, { minUnits: config.minUnits, minMedia: config.minMedia })) {
    throw new Error(`REFUS: ${id} ne satisfait plus le gate source Golden`);
  }
  const relevance = semantic.audit(live, originalQuery);
  const normalized = await scanner.normalizeCandidate(live);
  return { originalQuery, config, live, relevance, normalized };
}

async function main(argv = process.argv.slice(2), env = process.env) {
  golden.assertStaging(env);
  const mode = parseMode(argv);
  const id = parseSupplierProductId(argv);
  const before = await readExisting(id);
  if (!before) throw new Error(`Candidat Golden ${id} introuvable`);
  if (before.product_id || before.state !== 'scanned') {
    throw new Error(`REFUS: réparation réservée à un candidat scanned non promu (state=${before.state})`);
  }

  const { originalQuery, config, live, relevance, normalized } = await loadLiveContext(id, before, env);

  if (mode === 'dry-run') {
    const output = {
      mode,
      writes: false,
      supplier_product_id: id,
      original_query: originalQuery,
      semantic_relevance: relevance,
      source: golden.sourceSummary(live),
      before: golden.candidateSummary(before),
      projected_after_rescan: {
        komerce_category: normalized.komerce_category,
        category_source: normalized.data_sources?.category || null,
      },
      next_gate: relevance.relevant
        ? { action: 'REVIEW_PRICE', promotion: 'NOT_PERFORMED', place_order: 'HARD_STOP' }
        : { action: 'STOP_OFF_QUERY', promotion: 'NOT_PERFORMED', place_order: 'HARD_STOP' },
    };
    console.log(`[aliexpress-golden-repair] ${JSON.stringify(output)}`);
    return output;
  }

  if (env[golden.ALLOW_FLAG] !== '1') throw new Error(`${golden.ALLOW_FLAG}=1 requis`);

  const product = golden.withGoldenProvenance(live, config);
  product.raw_payload.discovery.semantic_relevance = relevance;

  const body = {
    supplier_name: 'AliExpress',
    source_type: 'api',
    supplier_id: 'aliexpress',
    source_filename: `aliexpress-golden-repair/${id}.json`,
    notes: `Golden repair staging — exact AliExpress product ${id}`,
    is_full_snapshot: false,
  };
  const dispatchOne = async () => ({ products: [product], invalid: [], total: 1 });
  const result = await catalogImportOrchestrator.importCatalog(body, null, dispatchOne);
  if (result.status !== 200 || Number(result.body?.accepted || 0) !== 1 || Number(result.body?.rejected || 0) !== 0) {
    throw new Error(`Réparation Golden refusée/incomplète: ${JSON.stringify(result.body).slice(0, 1200)}`);
  }
  const after = await readExisting(id);
  const output = {
    mode,
    writes: true,
    supplier_product_id: id,
    original_query: originalQuery,
    semantic_relevance: relevance,
    before: golden.candidateSummary(before),
    after: golden.candidateSummary(after),
    import: result.body,
    next_gate: relevance.relevant
      ? { action: 'REVIEW_PRICE', promotion: 'NOT_PERFORMED', place_order: 'HARD_STOP' }
      : { action: 'STOP_OFF_QUERY', promotion: 'NOT_PERFORMED', place_order: 'HARD_STOP' },
  };
  console.log(`[aliexpress-golden-repair] ${JSON.stringify(output)}`);
  return output;
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(`[aliexpress-golden-repair] FAILED: ${error.stack || error}`);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { parseSupplierProductId, parseMode, loadLiveContext, main };
