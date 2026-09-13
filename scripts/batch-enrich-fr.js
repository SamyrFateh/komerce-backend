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
 * @used-by       one-shot rattrapage Lot 1 (484 drafts AliExpress connector_raw source_locale=en)
 * @db-read       products, catalog_glossary, boutique_categories, catalog_field_overrides
 * @db-write-via:catalog-enrichment products, catalog_enrichment_runs
 * @db-txn        none (enrichAndApply gère ses propres écritures)
 * @doctrine      DOCTRINE_CATALOGUE.md §4 (langue), §8 (prompt versionné)
 * @impact-areas  catalog
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const catalogEnrichment = require('../services/catalog-enrichment');

// ── Configuration ───────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;
const CONCURRENCY = 5;
const DELAY_BETWEEN_BATCHES_MS = 1000;

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

// ── Requêtes ────────────────────────────────────────────────────────────────

const SELECT_DRAFTS = `
  SELECT id, product_ref, name, category, source_locale, content_source
  FROM products
  WHERE content_source = 'connector_raw'
    AND lifecycle_status = 'candidate'
    AND is_active = FALSE
    AND source_locale IS NOT NULL
    AND source_locale NOT LIKE 'fr%'
  ORDER BY product_ref
  LIMIT $1
`;

const COUNT_STATUS = `
  SELECT
    content_source,
    needs_review,
    COUNT(*)::int AS n
  FROM products
  WHERE lifecycle_status = 'candidate'
    AND is_active = FALSE
    AND content_source IN ('connector_raw', 'ai_enriched')
  GROUP BY content_source, needs_review
  ORDER BY 1, 2
`;

// ── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function enrichOne(productId, productRef) {
  try {
    const result = await catalogEnrichment.enrichAndApply(productId);
    return {
      productRef,
      productId,
      status: result.status || 'ok',
      confidence: result.confidence ?? null,
      needsReview: result.needs_review ?? null,
      error: null,
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

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { mode, limit, concurrency } = parseArgs();
  const isDryRun = mode === 'dry-run';

  console.log(`\n═══ batch-enrich-fr.js ═══`);
  console.log(`mode: ${mode}  limit: ${limit}  concurrency: ${concurrency}\n`);

  // Baseline
  const { rows: beforeRows } = await db.query(COUNT_STATUS);
  console.log('Baseline :');
  for (const r of beforeRows) {
    console.log(`  content_source=${r.content_source}  needs_review=${r.needs_review}  n=${r.n}`);
  }
  console.log('');

  // Sélection
  const { rows: drafts } = await db.query(SELECT_DRAFTS, [limit]);
  console.log(`Drafts connector_raw à enrichir : ${drafts.length}\n`);

  if (drafts.length === 0) {
    console.log('✅ Aucun draft connector_raw éligible — rien à faire.');
    return;
  }

  if (isDryRun) {
    console.log('DRY-RUN — aucun enrichissement exécuté. Échantillon :');
    for (const d of drafts.slice(0, 10)) {
      console.log(`  ${d.product_ref}  ${d.source_locale}  ${d.name.slice(0, 50)}`);
    }
    if (drafts.length > 10) console.log(`  ... et ${drafts.length - 10} autres`);
    console.log(`\nRelancer avec --execute pour enrichir les ${drafts.length} drafts.`);
    return;
  }

  // Exécution par lots
  let okCount = 0;
  let errorCount = 0;
  let reviewCount = 0;
  const errors = [];

  for (let i = 0; i < drafts.length; i += concurrency) {
    const batch = drafts.slice(i, i + concurrency);
    const batchNum = Math.floor(i / concurrency) + 1;
    const totalBatches = Math.ceil(drafts.length / concurrency);

    process.stdout.write(`Lot ${batchNum}/${totalBatches} (${batch.length} produits)...`);

    const results = await Promise.all(
      batch.map(d => enrichOne(d.id, d.product_ref))
    );

    for (const r of results) {
      if (r.status === 'error') {
        errorCount += 1;
        errors.push({ ref: r.productRef, error: r.error });
        process.stdout.write(' ✗');
      } else {
        okCount += 1;
        if (r.needsReview) reviewCount += 1;
        process.stdout.write(' ✓');
      }
    }
    console.log('');

    // Rate limit entre les lots
    if (i + concurrency < drafts.length) {
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  // Résumé
  console.log(`\n─── Résumé ───`);
  console.log(`ok: ${okCount}  needs_review: ${reviewCount}  errors: ${errorCount}  total: ${drafts.length}`);

  if (errors.length > 0) {
    console.log(`\nErreurs :`);
    for (const e of errors.slice(0, 20)) {
      console.log(`  ${e.ref} — ${e.error}`);
    }
    if (errors.length > 20) console.log(`  ... et ${errors.length - 20} autres`);
  }

  // Post-mesure
  const { rows: afterRows } = await db.query(COUNT_STATUS);
  console.log('\nAprès enrichissement :');
  for (const r of afterRows) {
    console.log(`  content_source=${r.content_source}  needs_review=${r.needs_review}  n=${r.n}`);
  }

  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('FATAL:', err); process.exit(1); });
