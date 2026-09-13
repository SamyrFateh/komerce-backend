#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          catalog-batch-enrichment-fr
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        DATABASE_URL, ANTHROPIC_API_KEY or OPENAI_API_KEY (selon CATALOG_ENRICH_PROVIDER)
 * @outputs       products.name (FR), products.description (FR), content_source → ai_enriched
 * @depends       db.js, services/catalog-enrichment.js
 * @used-by       one-shot rattrapage Lot 1 (drafts AliExpress connector_raw source_locale=en)
 * @db-read       products, sourcing_candidates, catalog_glossary, boutique_categories, catalog_field_overrides
 * @db-write-via:catalog-enrichment products, catalog_enrichment_runs
 * @db-txn        none (enrichAndApply gère ses propres écritures)
 * @doctrine      DOCTRINE_CATALOGUE.md §4 (langue), §8 (prompt versionné)
 * @impact-areas  catalog
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const catalogEnrichment = require('../services/catalog-enrichment');

const SUPPLIER_NAME = 'AliExpress';
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;
const CONCURRENCY = 5;
const DELAY_BETWEEN_BATCHES_MS = 1000;
const SUCCESS_STATUSES = new Set(['ok', 'low_confidence']);

function parseArgs(argv = process.argv.slice(2)) {
  let mode = 'dry-run';
  let limit = DEFAULT_LIMIT;
  let concurrency = CONCURRENCY;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') mode = 'dry-run';
    else if (arg === '--execute') mode = 'execute';
    else if (arg === '--limit') limit = Number.parseInt(argv[++i], 10);
    else if (arg.startsWith('--limit=')) limit = Number.parseInt(arg.split('=', 2)[1], 10);
    else if (arg === '--concurrency') concurrency = Number.parseInt(argv[++i], 10);
    else if (arg.startsWith('--concurrency=')) concurrency = Number.parseInt(arg.split('=', 2)[1], 10);
    else throw new Error(`Argument inconnu: ${arg}`);
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`--limit doit être un entier entre 1 et ${MAX_LIMIT}`);
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) {
    throw new Error('--concurrency doit être un entier entre 1 et 20');
  }
  return { mode, limit, concurrency };
}

const SELECT_DRAFTS = `
  SELECT DISTINCT
    p.id, p.product_ref, p.name, p.category, p.source_locale, p.content_source
  FROM products p
  JOIN sourcing_candidates sc ON sc.product_id = p.id
  WHERE sc.supplier_name = $1
    AND sc.state = 'imported_to_catalog'
    AND p.content_source = 'connector_raw'
    AND p.lifecycle_status = 'candidate'
    AND p.is_active = FALSE
    AND p.source_locale IS NOT NULL
    AND lower(p.source_locale) NOT LIKE 'fr%'
  ORDER BY p.product_ref
  LIMIT $2
`;

const COUNT_STATUS = `
  SELECT
    p.content_source,
    p.needs_review,
    COUNT(*)::int AS n
  FROM products p
  WHERE p.lifecycle_status = 'candidate'
    AND p.is_active = FALSE
    AND p.content_source IN ('connector_raw', 'ai_enriched')
    AND EXISTS (
      SELECT 1
      FROM sourcing_candidates sc
      WHERE sc.product_id = p.id
        AND sc.supplier_name = $1
        AND sc.state = 'imported_to_catalog'
    )
  GROUP BY p.content_source, p.needs_review
  ORDER BY 1, 2
`;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function enrichOne(productId, productRef) {
  try {
    const result = await catalogEnrichment.enrichAndApply(productId);
    return {
      productRef,
      productId,
      status: result.status || 'failed',
      confidence: result.confidence ?? null,
      needsReview: result.needsReview ?? result.needs_review ?? null,
      error: result.error || null,
    };
  } catch (err) {
    return {
      productRef,
      productId,
      status: 'error',
      confidence: null,
      needsReview: null,
      error: err.message,
    };
  }
}

async function main() {
  const { mode, limit, concurrency } = parseArgs();
  const isDryRun = mode === 'dry-run';

  console.log(`\n═══ batch-enrich-fr.js — ${SUPPLIER_NAME} ═══`);
  console.log(`mode: ${mode}  limit: ${limit}  concurrency: ${concurrency}\n`);

  const { rows: beforeRows } = await db.query(COUNT_STATUS, [SUPPLIER_NAME]);
  console.log(`Baseline ${SUPPLIER_NAME} :`);
  for (const r of beforeRows) {
    console.log(`  content_source=${r.content_source}  needs_review=${r.needs_review}  n=${r.n}`);
  }
  console.log('');

  const { rows: drafts } = await db.query(SELECT_DRAFTS, [SUPPLIER_NAME, limit]);
  console.log(`Drafts ${SUPPLIER_NAME} connector_raw à enrichir : ${drafts.length}\n`);

  if (drafts.length === 0) {
    console.log('✅ Aucun draft AliExpress connector_raw éligible — rien à faire.');
    return;
  }

  if (isDryRun) {
    console.log('DRY-RUN — aucun enrichissement exécuté. Échantillon :');
    for (const d of drafts.slice(0, 10)) {
      console.log(`  ${d.product_ref}  ${d.source_locale}  ${d.name.slice(0, 50)}`);
    }
    if (drafts.length > 10) console.log(`  ... et ${drafts.length - 10} autres`);
    console.log(`\nRelancer avec --execute pour enrichir ces ${drafts.length} drafts AliExpress.`);
    return;
  }

  let okCount = 0;
  let errorCount = 0;
  let reviewCount = 0;
  const errors = [];

  for (let i = 0; i < drafts.length; i += concurrency) {
    const batch = drafts.slice(i, i + concurrency);
    const batchNum = Math.floor(i / concurrency) + 1;
    const totalBatches = Math.ceil(drafts.length / concurrency);

    process.stdout.write(`Lot ${batchNum}/${totalBatches} (${batch.length} produits)...`);
    const results = await Promise.all(batch.map(d => enrichOne(d.id, d.product_ref)));

    for (const r of results) {
      if (!SUCCESS_STATUSES.has(r.status)) {
        errorCount += 1;
        errors.push({ ref: r.productRef, status: r.status, error: r.error || 'échec sans détail' });
        process.stdout.write(' ✗');
      } else {
        okCount += 1;
        if (r.needsReview) reviewCount += 1;
        process.stdout.write(' ✓');
      }
    }
    console.log('');

    if (i + concurrency < drafts.length) {
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  console.log(`\n─── Résumé ${SUPPLIER_NAME} ───`);
  console.log(`ok: ${okCount}  needs_review: ${reviewCount}  errors: ${errorCount}  total: ${drafts.length}`);

  if (errors.length > 0) {
    console.log('\nErreurs :');
    for (const e of errors.slice(0, 20)) {
      console.log(`  ${e.ref} — status=${e.status} — ${e.error}`);
    }
    if (errors.length > 20) console.log(`  ... et ${errors.length - 20} autres`);
  }

  const { rows: afterRows } = await db.query(COUNT_STATUS, [SUPPLIER_NAME]);
  console.log(`\nAprès enrichissement ${SUPPLIER_NAME} :`);
  for (const r of afterRows) {
    console.log(`  content_source=${r.content_source}  needs_review=${r.needs_review}  n=${r.n}`);
  }

  console.log('');
  if (errorCount > 0) {
    throw new Error(`Batch enrichissement incomplet: ${errorCount}/${drafts.length} échec(s)`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('FATAL:', err); process.exit(1); });
