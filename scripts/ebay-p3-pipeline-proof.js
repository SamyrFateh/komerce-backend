#!/usr/bin/env node
'use strict';

/**
 * @komerce-arch
 * @role          ebay-p3-pipeline-proof
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        EBAY_* sandbox credentials, isolated DATABASE_URL
 * @outputs       sanitized eBay P3 sourcing pipeline proof
 * @depends       db.js, services/sourcing-import-dispatch.js, services/suppliers/catalog-import-orchestrator.js
 * @used-by       operator / isolated Railway proof only
 * @db-read       supplier_catalog_imports, sourcing_candidates, sourcing_sources, sourcing_captures, sourcing_observations, sourcing_resolution_bindings
 * @db-write-via  services/suppliers/catalog-import-orchestrator.js
 * @db-txn        delegated
 * @doctrine      docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md, docs/doctrine/DOCTRINE_SOURCE_SHADOW_INGESTION.md, docs/doctrine/DOCTRINE_SOURCE_RESOLUTION.md
 * @impact-areas  catalog, sourcing, supplier-integration
 * @version       2026-09
 *
 * P3 ONLY.
 * Reads eBay Sandbox through the real connector and exercises the real Komerce
 * sourcing import pipeline on an ISOLATED database. It never invokes checkout,
 * placeOrder, payment, catalog promotion or a provider mutation.
 */

const http = require('http');
const db = require('../db');
const importDispatch = require('../services/sourcing-import-dispatch');
const catalogImport = require('../services/suppliers/catalog-import-orchestrator');

function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  if (details !== null) error.details = details;
  throw error;
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function collectPersistedProof(importId, captureId) {
  const [imports, candidates, sources, captures, observations, bindings] = await Promise.all([
    db.query(
      `SELECT id, supplier_name, source_type, total_items
         FROM supplier_catalog_imports
        WHERE id = $1`,
      [importId]
    ),
    db.query(
      `SELECT id, supplier_name, supplier_product_id, state,
              normalized_source_contract
         FROM sourcing_candidates
        WHERE import_id = $1
        ORDER BY id`,
      [importId]
    ),
    db.query(
      `SELECT source_id, adapter_type, acquisition, continuity
         FROM sourcing_sources
        WHERE source_id = 'api:ebay'`
    ),
    db.query(
      `SELECT capture_id, source_id, status, stats
         FROM sourcing_captures
        WHERE capture_id = $1`,
      [captureId]
    ),
    db.query(
      `SELECT observation_id, grain::text AS grain, source_ref, normalized
         FROM sourcing_observations
        WHERE capture_id = $1
        ORDER BY CASE grain::text WHEN 'product' THEN 1 WHEN 'offer' THEN 2 WHEN 'unit' THEN 3 ELSE 4 END,
                 observation_id`,
      [captureId]
    ),
    db.query(
      `SELECT rb.observation_id, rb.canonical_entity_id, ce.grain::text AS grain
         FROM sourcing_resolution_bindings rb
         JOIN sourcing_observations o ON o.observation_id = rb.observation_id
         JOIN sourcing_canonical_entities ce ON ce.canonical_entity_id = rb.canonical_entity_id
        WHERE o.capture_id = $1 AND rb.ended_at IS NULL
        ORDER BY rb.observation_id`,
      [captureId]
    ),
  ]);

  return {
    import_row: imports.rows?.[0] || null,
    candidates: candidates.rows || [],
    source: sources.rows?.[0] || null,
    capture: captures.rows?.[0] || null,
    observations: observations.rows || [],
    bindings: bindings.rows || [],
  };
}

function assertPersistedProof(snapshot, importResult) {
  if (!snapshot.import_row) fail('EBAY_P3_IMPORT_ROW_MISSING');
  if (snapshot.import_row.source_type !== 'api') fail('EBAY_P3_IMPORT_SOURCE_TYPE_INVALID');

  if (!snapshot.candidates.length) fail('EBAY_P3_CANDIDATE_MISSING');
  for (const candidate of snapshot.candidates) {
    const contract = candidate.normalized_source_contract;
    if (!contract || String(contract.schema_version) !== '2') {
      fail('EBAY_P3_CANDIDATE_V2_CONTRACT_MISSING');
    }
  }

  if (!snapshot.source || snapshot.source.source_id !== 'api:ebay') {
    fail('EBAY_P3_SOURCE_IDENTITY_MISSING');
  }
  if (snapshot.source.adapter_type !== 'ebay') fail('EBAY_P3_SOURCE_ADAPTER_INVALID');

  if (!snapshot.capture || snapshot.capture.status !== 'complete') {
    fail('EBAY_P3_CAPTURE_NOT_COMPLETE');
  }

  const grains = new Set(snapshot.observations.map(row => row.grain));
  for (const required of ['product', 'offer', 'unit']) {
    if (!grains.has(required)) fail(`EBAY_P3_${required.toUpperCase()}_OBSERVATION_MISSING`);
  }

  const productRows = snapshot.observations.filter(row => row.grain === 'product');
  const unitRows = snapshot.observations.filter(row => row.grain === 'unit');
  if (!unitRows.length) fail('EBAY_P3_UNIT_OBSERVATION_MISSING');

  if (productRows.some(row => row.normalized?.supplier_order_identity)) {
    fail('EBAY_P3_SOI_LEAKED_TO_PRODUCT');
  }

  for (const unit of unitRows) {
    const soi = unit.normalized?.supplier_order_identity;
    if (!soi || soi.provider !== 'ebay' || Number(soi.version) !== 1) {
      fail('EBAY_P3_UNIT_SOI_INVALID');
    }
    if (soi.payload?.environment !== 'sandbox') fail('EBAY_P3_UNIT_SOI_ENV_INVALID');
    if (soi.payload?.item_id !== unit.source_ref) fail('EBAY_P3_UNIT_SOURCE_REF_MISMATCH');
    if (!/^v1\|[^|]+\|[^|]+$/.test(String(unit.source_ref || ''))) {
      fail('EBAY_P3_UNIT_SOURCE_REF_INVALID');
    }
  }

  if (snapshot.bindings.length !== snapshot.observations.length) {
    fail('EBAY_P3_OBSERVATION_BINDING_INCOMPLETE', {
      observations: snapshot.observations.length,
      bindings: snapshot.bindings.length,
    });
  }

  const resolution = importResult?.body?.shadow_ingestion?.resolution;
  if (!resolution || resolution.status !== 'resolved') fail('EBAY_P3_RESOLUTION_NOT_RESOLVED');
  if (number(resolution.deferred_parent) !== 0) fail('EBAY_P3_RESOLUTION_DEFERRED_PARENT');
  if (number(resolution.review_required) !== 0) fail('EBAY_P3_RESOLUTION_REVIEW_REQUIRED');

  return {
    proof: 'EBAY_P3_PIPELINE_PASS',
    import_id: snapshot.import_row.id,
    candidate_count: snapshot.candidates.length,
    source_id: snapshot.source.source_id,
    capture_id: snapshot.capture.capture_id,
    observations: {
      total: snapshot.observations.length,
      product: snapshot.observations.filter(row => row.grain === 'product').length,
      offer: snapshot.observations.filter(row => row.grain === 'offer').length,
      unit: unitRows.length,
    },
    canonical_bindings: snapshot.bindings.length,
    resolution: {
      status: resolution.status,
      new_canonical: number(resolution.new_canonical),
      linked: number(resolution.linked),
      review_required: number(resolution.review_required),
      deferred_parent: number(resolution.deferred_parent),
    },
    provider: 'ebay',
    environment: 'sandbox',
    place_order_invoked: false,
    provider_mutation_invoked: false,
  };
}

async function runProof() {
  if (!process.env.DATABASE_URL) fail('EBAY_P3_DATABASE_URL_REQUIRED');

  const result = await catalogImport.importCatalog({
    supplier_name: 'eBay Sandbox',
    source_type: 'api',
    supplier_id: 'ebay',
    keyword: process.env.EBAY_P3_QUERY || 'iphone',
    page_size: Number(process.env.EBAY_P3_LIMIT || 3),
    notes: 'external-provider P3 isolated proof',
    is_full_snapshot: false,
  }, null, importDispatch.dispatchToConnector);

  if (result?.status !== 200) fail('EBAY_P3_IMPORT_REJECTED', result?.body || null);
  if (!result?.body?.import_id) fail('EBAY_P3_IMPORT_ID_MISSING');

  const shadow = result.body.shadow_ingestion;
  if (!shadow || shadow.status !== 'recorded' || !shadow.capture_id) {
    fail('EBAY_P3_SHADOW_NOT_RECORDED', shadow || null);
  }

  const persisted = await collectPersistedProof(result.body.import_id, shadow.capture_id);
  return assertPersistedProof(persisted, result);
}

async function main() {
  try {
    const proof = await runProof();
    process.stdout.write(JSON.stringify(proof) + '\n');

    if (process.env.PROOF_HEALTH_SERVER === '1') {
      const port = Number(process.env.PORT || 3000);
      http.createServer((req, res) => {
        if (req.url === '/health') {
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(proof));
          return;
        }
        res.statusCode = 404;
        res.end('not found');
      }).listen(port, '0.0.0.0', () => {
        process.stdout.write('EBAY_P3_HEALTH_READY\n');
      });
      return;
    }

    process.exitCode = 0;
  } catch (error) {
    console.error('EBAY_P3_PIPELINE_BLOCKED', error.code || error.message);
    if (error.details) console.error(JSON.stringify(error.details));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  runProof,
  collectPersistedProof,
  assertPersistedProof,
};
