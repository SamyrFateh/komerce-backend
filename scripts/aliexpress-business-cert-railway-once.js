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
    SELECT ps.id, p.product_ref
      FROM product_skus ps
      JOIN products p ON p.id=ps.product_id
     WHERE ps.is_active=TRUE
       AND ps.source='SUPPLIER'
       AND ps.supplier_order_identity->>'provider'='aliexpress'
     ORDER BY ps.id LIMIT 1
  `);
  if (existing.rows.length) return existing.rows[0];

  const golden = require('./aliexpress-golden-e2e');
  await golden.executeImport(PRODUCT_ID, process.env);

  const { rows } = await db.query(`
    SELECT id, state, product_id, supplier_product_id, scan_result,
           normalized_source_contract, rejected_reason
      FROM sourcing_candidates
     WHERE supplier_name='AliExpress' AND supplier_product_id=$1
     ORDER BY updated_at DESC LIMIT 1
  `, [PRODUCT_ID]);
  if (rows.length !== 1) throw new Error('ALIEXPRESS_CERT_CANDIDATE_MISSING');

  const { evaluateSourcingCandidateOutcome } = require('../services/sourcing-certification');
  const { promoteCandidate } = require('../services/sourcing-candidate-actions');
  const candidate = rows[0];
  const verdict = evaluateSourcingCandidateOutcome(candidate);
  if (!(verdict?.outcome_valid && verdict?.sourcing_certified)) {
    throw new Error(`ALIEXPRESS_CERT_NOT_SOURCING_CERTIFIED:${verdict?.outcome || 'unknown'}`);
  }
  const price = Number(candidate.scan_result?.test_price_kmf);
  if (!(price > 0)) throw new Error('ALIEXPRESS_CERT_TEST_PRICE_MISSING');
  const authority = String(candidate.scan_result?.recommended_price_authority || candidate.scan_result?.price_authority || '');
  if (authority !== 'ECONOMIC_REFERENCE_NOT_MARKET_DECISION') {
    throw new Error(`ALIEXPRESS_CERT_PRICE_AUTHORITY:${authority || 'missing'}`);
  }
  const promoted = await promoteCandidate(candidate.id, {
    price_kmf: Math.round(price),
    enrichment_mode: 'source_only',
  }, null);
  const check = await db.query(`
    SELECT p.product_ref, p.is_active, p.lifecycle_status, ps.id AS product_sku_id,
           EXISTS(SELECT 1 FROM product_market_exposure pme WHERE pme.product_id=p.id) AS exposed
      FROM products p
      JOIN product_skus ps ON ps.product_id=p.id
     WHERE p.id=$1
       AND ps.is_active=TRUE
       AND ps.source='SUPPLIER'
       AND ps.supplier_order_identity->>'provider'='aliexpress'
     ORDER BY ps.id LIMIT 1
  `, [promoted.product_id]);
  if (check.rows.length !== 1) throw new Error('ALIEXPRESS_CERT_PROMOTED_SKU_MISSING');
  if (check.rows[0].is_active === true || check.rows[0].exposed === true) {
    throw new Error('ALIEXPRESS_CERT_DRAFT_MUST_REMAIN_INACTIVE_UNEXPOSED');
  }
  return { id: check.rows[0].product_sku_id, product_ref: check.rows[0].product_ref };
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

  const target = new Pool({ connectionString: process.env.DATABASE_URL, ssl: sslFor(process.env.DATABASE_URL), max: 2 });
  try {
    const initialized = await initializeDisposable(target);
    console.log(`DISPOSABLE_DB_INITIALIZED=${initialized}`);
    const targeted = [
      ['migrations/250_boutique_subcategory_customs_affinity.sql',
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutique_subcategories' AND column_name='customs_category_key') AS ready"],
      ['migrations/257_import_runtime_runs.sql',
        "SELECT to_regclass('public.import_runtime_runs') IS NOT NULL AS ready"],
      ['migrations/258_import_runtime_item_events.sql',
        "SELECT to_regclass('public.import_runtime_item_events') IS NOT NULL AS ready"],
    ];
    for (const [file, probe] of targeted) {
      const { rows:[state] } = await target.query(probe);
      if (!state?.ready) {
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
    const report = await cert.run([`--mode=${mode}`], { env: process.env, query: db.query.bind(db) });
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
