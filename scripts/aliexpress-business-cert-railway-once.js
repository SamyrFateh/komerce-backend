#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PRODUCT_ID = '1005011891302792';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}
function sslFor(url) {
  return String(url || '').includes('sslmode=require') ? { rejectUnauthorized: false } : false;
}
async function initializeDisposable(target) {
  const reset = ['1','true','yes'].includes(String(process.env.KOMERCE_ALIEXPRESS_CERT_RESET || '').trim().toLowerCase());
  if (reset) {
    const prodUrl = required('PROD_DATABASE_URL');
    const targetUrl = required('DATABASE_URL');
    if (prodUrl === targetUrl) throw new Error('DISPOSABLE_DB_MUST_DIFFER_FROM_PROD');
    await target.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    console.log('DISPOSABLE_DB_RESET=true');
  }
  const { rows:[row] } = await target.query("SELECT to_regclass('public.sourcing_candidates') AS exists");
  if (row?.exists) return false;
  const sql = fs.readFileSync(path.join(__dirname, '..', 'docs', 'db', 'railway-live-schema.sql'), 'utf8');
  await target.query(sql);
  return true;
}
async function copyEncryptedOauth(target) {
  const prodUrl = required('PROD_DATABASE_URL');
  const targetUrl = required('DATABASE_URL');
  if (prodUrl === targetUrl) throw new Error('DISPOSABLE_DB_MUST_DIFFER_FROM_PROD');
  const prod = new Pool({ connectionString: prodUrl, ssl: sslFor(prodUrl), max: 1 });
  try {
    const { rows } = await prod.query(`
      SELECT supplier_key,
             access_token_ciphertext, access_token_iv, access_token_tag,
             refresh_token_ciphertext, refresh_token_iv, refresh_token_tag,
             access_expires_at, refresh_expires_at,
             provider_user_id, provider_user_nick, token_type,
             created_at, updated_at, last_refreshed_at
        FROM supplier_oauth_connections
       WHERE supplier_key = $1
    `, ['aliexpress']);
    if (rows.length !== 1) throw new Error(`ALIEXPRESS_OAUTH_ROW_COUNT_${rows.length}`);
    const r = rows[0];
    await target.query(`
      INSERT INTO supplier_oauth_connections (
        supplier_key,
        access_token_ciphertext, access_token_iv, access_token_tag,
        refresh_token_ciphertext, refresh_token_iv, refresh_token_tag,
        access_expires_at, refresh_expires_at,
        provider_user_id, provider_user_nick, token_type,
        created_at, updated_at, last_refreshed_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (supplier_key) DO UPDATE SET
        access_token_ciphertext=EXCLUDED.access_token_ciphertext,
        access_token_iv=EXCLUDED.access_token_iv,
        access_token_tag=EXCLUDED.access_token_tag,
        refresh_token_ciphertext=EXCLUDED.refresh_token_ciphertext,
        refresh_token_iv=EXCLUDED.refresh_token_iv,
        refresh_token_tag=EXCLUDED.refresh_token_tag,
        access_expires_at=EXCLUDED.access_expires_at,
        refresh_expires_at=EXCLUDED.refresh_expires_at,
        provider_user_id=EXCLUDED.provider_user_id,
        provider_user_nick=EXCLUDED.provider_user_nick,
        token_type=EXCLUDED.token_type,
        updated_at=EXCLUDED.updated_at,
        last_refreshed_at=EXCLUDED.last_refreshed_at
    `, [
      r.supplier_key,
      r.access_token_ciphertext, r.access_token_iv, r.access_token_tag,
      r.refresh_token_ciphertext, r.refresh_token_iv, r.refresh_token_tag,
      r.access_expires_at, r.refresh_expires_at,
      r.provider_user_id, r.provider_user_nick, r.token_type,
      r.created_at, r.updated_at, r.last_refreshed_at
    ]);
    console.log('ALIEXPRESS_OAUTH_COPY=encrypted_row_only');
  } finally {
    await prod.end();
  }
}
async function ensureCanonicalSku(db) {
  const existing = await db.query(`
    SELECT ps.id, ps.product_id, ps.supplier_sku, ps.supplier_unit_ref, ps.supplier_order_identity, p.product_ref
      FROM product_skus ps
      JOIN products p ON p.id=ps.product_id
     WHERE ps.is_active=TRUE
       AND ps.source='SUPPLIER'
       AND ps.supplier_order_identity->>'provider'='aliexpress'
     ORDER BY ps.id LIMIT 1
  `);
  if (existing.rows.length) {
    const row = existing.rows[0];
    const linkage = require('../services/sourcing-catalog-product-linkage');
    const canonicalProductIds = await linkage.findCanonicalProductIdsForCatalogProduct(row.product_id, db.query.bind(db));
    const trace = await db.query(`
      SELECT sc.id AS candidate_id, sc.import_id, sc.normalized_source_contract,
             (SELECT COUNT(*)::int FROM sourcing_captures c
               WHERE NULLIF(c.stats->>'import_id','')::uuid = sc.import_id) AS captures,
             (SELECT COUNT(*)::int
                FROM sourcing_observations o
                JOIN sourcing_captures c ON c.capture_id=o.capture_id
               WHERE NULLIF(c.stats->>'import_id','')::uuid = sc.import_id
                 AND o.grain::text='product'
                 AND o.source_ref=sc.supplier_product_id) AS product_observations,
             (SELECT COUNT(*)::int
                FROM sourcing_resolution_bindings rb
                JOIN sourcing_observations o ON o.observation_id=rb.observation_id
                JOIN sourcing_captures c ON c.capture_id=o.capture_id
               WHERE NULLIF(c.stats->>'import_id','')::uuid = sc.import_id
                 AND o.grain::text='product'
                 AND o.source_ref=sc.supplier_product_id
                 AND rb.ended_at IS NULL) AS active_product_bindings
        FROM sourcing_candidates sc
       WHERE sc.product_id=$1
       ORDER BY sc.updated_at DESC LIMIT 1
    `, [row.product_id]);
    console.log(`ALIEXPRESS_CERT_EXISTING_CHAIN=${JSON.stringify({
      product_ref: row.product_ref,
      canonical_product_ids: canonicalProductIds,
      ...(trace.rows[0] || {}),
    })}`);

    if (!canonicalProductIds.length && Number(trace.rows[0]?.active_product_bindings || 0) === 0) {
      const capture = await db.query(`
        SELECT c.capture_id
          FROM sourcing_captures c
         WHERE NULLIF(c.stats->>'import_id','')::uuid = $1::uuid
         ORDER BY c.started_at DESC
         LIMIT 1
      `, [trace.rows[0]?.import_id]);
      if (capture.rows.length !== 1) throw new Error('ALIEXPRESS_CERT_CAPTURE_NOT_EXACT');
      const shadowResolver = require('../services/sourcing-shadow-resolution-service');
      const resolution = await shadowResolver.resolveCaptureShadow(capture.rows[0].capture_id);
      console.log(`ALIEXPRESS_CERT_SHADOW_RESOLUTION=${JSON.stringify(resolution)}`);
    }

    const units = Array.isArray(trace.rows[0]?.normalized_source_contract?.sellable_units)
      ? trace.rows[0].normalized_source_contract.sellable_units
      : [];
    const canonicalUnit = units.find((unit) =>
      String(unit?.supplier_unit_ref || '') === String(row.supplier_unit_ref || '')
      && unit?.supplier_order_identity?.provider === 'aliexpress'
    );
    if (canonicalUnit) {
      const desiredIdentity = canonicalUnit.supplier_order_identity;
      if (JSON.stringify(row.supplier_order_identity || {}) !== JSON.stringify(desiredIdentity)) {
        await db.query(`
          UPDATE product_skus
             SET supplier_sku=$2,
                 supplier_unit_ref=$3,
                 supplier_order_identity=$4::jsonb,
                 updated_at=now()
           WHERE id=$1
        `, [
          row.id,
          String(canonicalUnit.supplier_sku),
          String(canonicalUnit.supplier_unit_ref),
          JSON.stringify(desiredIdentity),
        ]);
        row.supplier_sku = String(canonicalUnit.supplier_sku);
        row.supplier_unit_ref = String(canonicalUnit.supplier_unit_ref);
        row.supplier_order_identity = desiredIdentity;
        console.log('ALIEXPRESS_CERT_EXISTING_SKU_RECONCILED=true');
      }
    }
    return row;
  }

  let { rows } = await db.query(`
    SELECT id, state, product_id, import_id, supplier_name, supplier_product_id, raw_payload,
           scan_result, normalized_source_contract, rejected_reason
      FROM sourcing_candidates
     WHERE supplier_name='AliExpress' AND supplier_product_id=$1
     ORDER BY updated_at DESC LIMIT 1
  `, [PRODUCT_ID]);

  if (rows.length === 0) {
    const golden = require('./aliexpress-golden-e2e');
    await golden.executeImport(PRODUCT_ID, process.env);
    ({ rows } = await db.query(`
      SELECT id, state, product_id, import_id, supplier_name, supplier_product_id, raw_payload,
             scan_result, normalized_source_contract, rejected_reason
        FROM sourcing_candidates
       WHERE supplier_name='AliExpress' AND supplier_product_id=$1
       ORDER BY updated_at DESC LIMIT 1
    `, [PRODUCT_ID]));
  }
  if (rows.length !== 1) throw new Error('ALIEXPRESS_CERT_CANDIDATE_MISSING');

  const { evaluateSourcingCandidateOutcome } = require('../services/sourcing-certification');
  const candidate = rows[0];
  const verdict = evaluateSourcingCandidateOutcome(candidate);
  console.log(`ALIEXPRESS_CERT_CANDIDATE=${JSON.stringify({
    id: candidate.id,
    state: candidate.state,
    supplier_product_id: candidate.supplier_product_id,
    sourcing_decision: candidate.scan_result?.sourcing_decision || null,
    source_contract_version: candidate.normalized_source_contract?.schema_version || null,
    verdict,
  })}`);

  if (String(candidate.normalized_source_contract?.schema_version || '') !== '2') {
    throw new Error('ALIEXPRESS_CERT_SOURCE_CONTRACT_V2_REQUIRED');
  }

  // Purchasing proof is intentionally independent from merchandising/sourcing
  // decisions. A WATCH product must never be promoted to the catalogue just to
  // prove provider execution. In this disposable DB only, create an inactive,
  // unexposed parent product plus one active supplier SKU that is linked back
  // to the already-resolved canonical product through sourcing_candidates.
  const proofProduct = await db.query(`
    INSERT INTO products (
      name, price_kmf, stock, is_active, is_available,
      lifecycle_status, inventory_model, source, sourcing_source
    ) VALUES (
      'AliExpress purchasing certification fixture',
      1, 0, FALSE, FALSE,
      'candidate', 'SKU', 'ALIEXPRESS_CERT_PROOF', 'AliExpress'
    )
    RETURNING id, product_ref
  `);
  const product = proofProduct.rows[0];

  await db.query(
    'UPDATE sourcing_candidates SET product_id=$1, updated_at=now() WHERE id=$2',
    [product.id, candidate.id]
  );

  const sellableUnits = Array.isArray(candidate.normalized_source_contract?.sellable_units)
    ? candidate.normalized_source_contract.sellable_units
    : [];
  const proofUnit = sellableUnits.find((unit) =>
    unit?.supplier_order_identity?.provider === 'aliexpress'
    && unit?.supplier_unit_ref
    && unit?.supplier_sku
  );
  if (!proofUnit) throw new Error('ALIEXPRESS_CERT_PROOF_UNIT_MISSING');
  const supplierSku = String(proofUnit.supplier_sku);
  const supplierUnitRef = String(proofUnit.supplier_unit_ref);
  const soi = proofUnit.supplier_order_identity;
  const proofSku = await db.query(`
    INSERT INTO product_skus (
      product_id, sku, stock, is_active, supplier_sku, source,
      supplier_unit_ref, supplier_order_identity
    ) VALUES ($1,$2,1,TRUE,$3,'SUPPLIER',$4,$5::jsonb)
    RETURNING id
  `, [
    product.id,
    'ALIEXPRESS-CERT-PROOF',
    supplierSku,
    supplierUnitRef,
    JSON.stringify(soi),
  ]);

  const exposed = await db.query(
    'SELECT EXISTS(SELECT 1 FROM product_market_exposure WHERE product_id=$1) AS exposed',
    [product.id]
  );
  if (exposed.rows[0]?.exposed === true) {
    throw new Error('ALIEXPRESS_CERT_PROOF_PRODUCT_MUST_REMAIN_UNEXPOSED');
  }

  const linkage = require('../services/sourcing-catalog-product-linkage');
  const canonicalProductIds = await linkage.findCanonicalProductIdsForCatalogProduct(product.id, db.query.bind(db));
  const chain = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM sourcing_captures c
        WHERE NULLIF(c.stats->>'import_id','')::uuid = $1::uuid) AS captures,
      (SELECT COUNT(*)::int
         FROM sourcing_observations o
         JOIN sourcing_captures c ON c.capture_id=o.capture_id
        WHERE NULLIF(c.stats->>'import_id','')::uuid = $1::uuid
          AND o.grain::text='product'
          AND o.source_ref=$2) AS product_observations,
      (SELECT COUNT(*)::int
         FROM sourcing_resolution_bindings rb
         JOIN sourcing_observations o ON o.observation_id=rb.observation_id
         JOIN sourcing_captures c ON c.capture_id=o.capture_id
        WHERE NULLIF(c.stats->>'import_id','')::uuid = $1::uuid
          AND o.grain::text='product'
          AND o.source_ref=$2
          AND rb.ended_at IS NULL) AS active_product_bindings
  `, [candidate.import_id, PRODUCT_ID]);
  console.log(`ALIEXPRESS_CERT_CANONICAL_CHAIN=${JSON.stringify({
    import_id: candidate.import_id || null,
    canonical_product_ids: canonicalProductIds,
    ...(chain.rows[0] || {}),
  })}`);

  console.log(`ALIEXPRESS_CERT_PROOF_SKU_CREATED=${proofSku.rows[0].id}`);
  return { id: proofSku.rows[0].id, product_ref: product.product_ref };
}

async function main() {
  if (String(process.env.KOMERCE_ENV || '').toLowerCase() !== 'staging') throw new Error('KOMERCE_ENV_STAGING_REQUIRED');
  required('DATABASE_URL');
  required('PROD_DATABASE_URL');
  required('ALIEXPRESS_APP_KEY');
  required('ALIEXPRESS_APP_SECRET');
  required('ALIEXPRESS_TOKEN_ENCRYPTION_KEY');
  const mode = String(process.env.KOMERCE_ALIEXPRESS_CERT_MODE || 'readiness').trim().toLowerCase();
  if (!['readiness','order'].includes(mode)) throw new Error('ALIEXPRESS_CERT_MODE_INVALID');

  const target = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: sslFor(process.env.DATABASE_URL),
    max: 2,
    options: '-c search_path=public',
  });
  try {
    const initialized = await initializeDisposable(target);
    await target.query('SET search_path TO public');
    console.log('DISPOSABLE_DB_SEARCH_PATH=public');
    console.log(`DISPOSABLE_DB_INITIALIZED=${initialized}`);
    const targeted = [
      ['migrations/227_sourcing_resolution_foundation.sql',
        "SELECT to_regclass('public.sourcing_resolution_bindings') IS NOT NULL AS ready"],
      ['migrations/250_boutique_subcategory_customs_affinity.sql',
        "SELECT to_regclass('public.boutique_subcategories') IS NULL OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutique_subcategories' AND column_name='customs_category_key') AS ready"],
      ['migrations/256_provider_runtime_certification.sql',
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sourcing_sources' AND column_name='production_certified_capture_id') AS ready"],
      ['migrations/257_import_runtime_runs.sql',
        "SELECT to_regclass('public.import_runtime_runs') IS NOT NULL AS ready"],
      ['migrations/258_import_runtime_item_events.sql',
        "SELECT to_regclass('public.import_runtime_item_events') IS NOT NULL AS ready"],
    ];
    for (const [file, probe] of targeted) {
      const { rows:[state] } = await target.query(probe);
      if (!state?.ready) {
        console.log(`DISPOSABLE_DB_PATCH_APPLYING=${path.basename(file)}`);
        await target.query(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
        console.log(`DISPOSABLE_DB_PATCH=${path.basename(file)}`);
      }
    }
    await copyEncryptedOauth(target);

    // db.js is loaded only after the disposable schema exists.
    const db = require('../db');
    const sku = await ensureCanonicalSku(db);
    console.log(`ALIEXPRESS_CANONICAL_SKU_READY=${sku.product_ref}`);

    const cert = require('./aliexpress-business-certification');
    let report;
    try {
      report = await cert.run([`--mode=${mode}`], { env: process.env, query: db.query.bind(db) });
    } catch (error) {
      if (Array.isArray(error?.failures)) {
        console.log(`ALIEXPRESS_CERT_FAILURES=${JSON.stringify(error.failures)}`);
      }
      throw error;
    }
    console.log(`ALIEXPRESS_CERT_FINAL=${JSON.stringify(report)}`);
    await db.pool.end();
  } finally {
    await target.end();
  }
}

main().catch(error => {
  console.error(`[aliexpress-business-cert-railway-once] FAILED: ${error.stack || error}`);
  process.exitCode = 1;
});
