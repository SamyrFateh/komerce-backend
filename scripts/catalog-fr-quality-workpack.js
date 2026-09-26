#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          catalog-french-quality-workpack-exporter
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        disposable catalog checkpoint
 * @outputs       batched source-faithful translation workpack JSON
 * @depends       db.js, services/catalog-fr-quality.js
 * @used-by       isolated-cj-fr-quality-workpack.yml
 * @db-read       sourcing_candidates, products
 * @db-write      none
 * @db-txn        none
 * @doctrine      offline_ai_assistance, source_truth_preserved, no_runtime_llm_dependency
 * @impact-areas  catalog, product-detail, staging
 * @version       2026-09-v1
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const {
  sourceDocumentFromRow,
  sourceFingerprint,
  TITLE_MAX,
  DESCRIPTION_MIN,
  DESCRIPTION_MAX,
} = require('../services/catalog-fr-quality');

const SUPPLIER = 'CJdropshipping';
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 1000;
const DEFAULT_BATCH_SIZE = 40;
const MAX_BATCH_SIZE = 50;
const DEFAULT_OUTPUT_DIR = path.resolve('artifacts/catalog-fr-quality-workpack');

function intArg(value, fallback, min, max, label) {
  if (value == null || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} doit être un entier entre ${min} et ${max}`);
  }
  return parsed;
}

function parseArgs(argv = process.argv.slice(2)) {
  let limit = DEFAULT_LIMIT;
  let batchSize = DEFAULT_BATCH_SIZE;
  let outputDir = DEFAULT_OUTPUT_DIR;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--limit') limit = intArg(argv[++i], DEFAULT_LIMIT, 1, MAX_LIMIT, '--limit');
    else if (arg.startsWith('--limit=')) limit = intArg(arg.split('=', 2)[1], DEFAULT_LIMIT, 1, MAX_LIMIT, '--limit');
    else if (arg === '--batch-size') batchSize = intArg(argv[++i], DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE, '--batch-size');
    else if (arg.startsWith('--batch-size=')) batchSize = intArg(arg.split('=', 2)[1], DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE, '--batch-size');
    else if (arg === '--output-dir') outputDir = path.resolve(String(argv[++i] || '').trim());
    else if (arg.startsWith('--output-dir=')) outputDir = path.resolve(String(arg.split('=', 2)[1] || '').trim());
    else throw new Error(`Argument inconnu: ${arg}`);
  }

  return { limit, batchSize, outputDir };
}

function assertDisposableRuntime(env = process.env) {
  if (String(env.KOMERCE_ENV || '').trim().toLowerCase() !== 'staging' || env.NODE_ENV !== 'test') {
    throw new Error('REFUS: KOMERCE_ENV=staging et NODE_ENV=test requis');
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  const url = new URL(env.DATABASE_URL);
  const dbName = String(url.pathname || '').replace(/^\//, '');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || dbName !== 'komerce_real_catalog_stress') {
    throw new Error('REFUS: base jetable localhost komerce_real_catalog_stress requise');
  }
}

async function loadRows(limit) {
  const { rows } = await db.query(
    `SELECT p.id AS product_id,
            p.product_ref,
            p.name AS current_name,
            p.description AS current_description,
            p.name_source,
            p.description_source,
            p.source_locale,
            p.category,
            p.subcategory,
            p.content_source,
            p.needs_review,
            sc.supplier_name,
            sc.supplier_product_id,
            sc.supplier_category,
            sc.normalized_source_contract,
            UPPER(COALESCE(sc.scan_result->>'sourcing_decision','UNKNOWN')) AS sourcing_decision
       FROM sourcing_candidates sc
       JOIN products p ON p.id=sc.product_id
      WHERE sc.supplier_name=$1
        AND sc.state='imported_to_catalog'
        AND sc.product_id IS NOT NULL
        AND p.lifecycle_status='candidate'
        AND p.is_active=FALSE
      ORDER BY p.product_ref
      LIMIT $2`,
    [SUPPLIER, limit]
  );
  return rows;
}

function buildEntry(row) {
  const source = sourceDocumentFromRow(row);
  return {
    product_ref: row.product_ref,
    supplier_name: row.supplier_name,
    supplier_product_id: row.supplier_product_id,
    sourcing_decision: row.sourcing_decision,
    source_hash: sourceFingerprint(source),
    source,
    current_output: {
      title_fr: row.current_name || null,
      description_fr: row.current_description || null,
      content_source: row.content_source,
      needs_review: row.needs_review,
    },
  };
}

function translationContract() {
  return {
    language: 'fr-FR',
    title_max_chars: TITLE_MAX,
    description_min_chars: DESCRIPTION_MIN,
    description_max_chars: DESCRIPTION_MAX,
    rules: [
      'Traduire et réécrire en français naturel de boutique, pas mot à mot.',
      'Ne jamais inventer une caractéristique, une matière, une compatibilité, une capacité ou une performance absente de source.',
      'Conserver fidèlement les marques, références, modèles, mesures, capacités et unités techniques présentes.',
      'Supprimer le bruit fournisseur et marketing: hot sale, best seller, high quality, new arrival, factory direct.',
      'Un titre doit identifier le produit clairement et rester <= 80 caractères.',
      'La description doit être utile au client, factuelle, lisible et rester dans les limites indiquées.',
      'Ne pas traduire les marques et références techniques.',
      'Ne pas décider la publication, le prix, le stock, la disponibilité ni l’exposition marché.',
      'Ne pas modifier category/subcategory dans ce pass; signaler seulement une anomalie en note si nécessaire.',
      'Faire un second passage de contrôle source→FR avant de mettre review_status=PASS.',
    ],
    expected_output_shape: {
      translations: [
        {
          product_ref: 'KPR-...',
          source_hash: '<copier exactement>',
          title_fr: 'Titre français naturel',
          description_fr: 'Description française factuelle',
          review_status: 'PASS après un second passage de contrôle source→FR',
          review_note: 'optionnel; expliquer toute ambiguïté ou correction',
          note: 'optionnel, uniquement si ambiguïté source ou anomalie taxonomique',
        },
      ],
    },
  };
}

function writeBatches(entries, outputDir, batchSize) {
  fs.mkdirSync(outputDir, { recursive: true });
  const batches = [];

  for (let offset = 0; offset < entries.length; offset += batchSize) {
    const batchNo = Math.floor(offset / batchSize) + 1;
    const slice = entries.slice(offset, offset + batchSize);
    const fileName = `batch-${String(batchNo).padStart(3, '0')}.json`;
    const payload = {
      schema_version: 1,
      batch_number: batchNo,
      batch_size: slice.length,
      translation_contract: translationContract(),
      products: slice,
    };
    fs.writeFileSync(path.join(outputDir, fileName), JSON.stringify(payload, null, 2) + '\n', 'utf8');
    batches.push({ batch_number: batchNo, file: fileName, products: slice.length });
  }

  const manifest = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    authority: 'SOURCE_WORKPACK_FOR_OFFLINE_AI_ASSISTED_FRENCH_PREPARATION',
    supplier: SUPPLIER,
    total_products: entries.length,
    batch_size: batchSize,
    batch_count: batches.length,
    api_calls: 0,
    paid_ai_dependency: false,
    translation_contract: translationContract(),
    batches,
  };
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return manifest;
}

async function run(options = parseArgs()) {
  assertDisposableRuntime();
  const rows = await loadRows(options.limit);
  const entries = rows.map(buildEntry);
  const manifest = writeBatches(entries, options.outputDir, options.batchSize);
  console.log(`[catalog-fr-quality-workpack] ${JSON.stringify({
    products: manifest.total_products,
    batches: manifest.batch_count,
    batch_size: manifest.batch_size,
    output_dir: options.outputDir,
    api_calls: 0,
    paid_ai_dependency: false,
  })}`);
  return manifest;
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(`[catalog-fr-quality-workpack] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  SUPPLIER,
  DEFAULT_LIMIT,
  DEFAULT_BATCH_SIZE,
  parseArgs,
  assertDisposableRuntime,
  buildEntry,
  translationContract,
  writeBatches,
  run,
};
