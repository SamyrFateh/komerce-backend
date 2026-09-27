#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          catalog-french-quality-offline-apply
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        offline AI-assisted French translation JSON, disposable catalog checkpoint
 * @outputs       atomic traced manual overrides + French review-candidate audit report
 * @depends       db.js, services/catalog-overrides.js, services/catalog-fr-quality.js
 * @used-by       operator-assisted FR Quality Pass
 * @db-read       sourcing_candidates, products
 * @db-write-via  catalog-overrides
 * @db-txn        one all-or-nothing transaction for the submitted batch
 * @doctrine      source_truth_preserved, offline_ai_assistance, no_runtime_llm_dependency, no_publication
 * @impact-areas  catalog, product-detail, staging
 * @version       2026-09-v1
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const catalogOverrides = require('../services/catalog-overrides');
const {
  sourceDocumentFromRow,
  sourceFingerprint,
  proposalFingerprint,
  evaluateFrenchCopy,
  normalizeSpace,
} = require('../services/catalog-fr-quality');

const SUPPLIER = 'CJdropshipping';
const DEFAULT_REPORT = path.resolve('artifacts/catalog-fr-quality-apply-report.json');

function parseArgs(argv = process.argv.slice(2)) {
  let input = null;
  let review = null;
  let execute = false;
  let output = DEFAULT_REPORT;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') input = path.resolve(String(argv[++i] || '').trim());
    else if (arg.startsWith('--input=')) input = path.resolve(String(arg.split('=', 2)[1] || '').trim());
    else if (arg === '--review') review = path.resolve(String(argv[++i] || '').trim());
    else if (arg.startsWith('--review=')) review = path.resolve(String(arg.split('=', 2)[1] || '').trim());
    else if (arg === '--output') output = path.resolve(String(argv[++i] || '').trim());
    else if (arg.startsWith('--output=')) output = path.resolve(String(arg.split('=', 2)[1] || '').trim());
    else if (arg === '--execute') execute = true;
    else if (arg === '--dry-run') execute = false;
    else throw new Error(`Argument inconnu: ${arg}`);
  }

  if (!input) throw new Error('--input requis');
  if (!review) throw new Error('--review requis');
  if (path.resolve(input) === path.resolve(review)) throw new Error('--review doit être un artifact séparé de --input');
  return { input, review, execute, output };
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

function translationRowsFromPayload(payload, fileName) {
  const rows = Array.isArray(payload) ? payload : payload?.translations;
  if (!Array.isArray(rows)) {
    throw new Error(`${fileName}: tableau translations requis`);
  }
  return rows.map((row, index) => ({
    ...row,
    _file: fileName,
    _index: index,
  }));
}

function reviewRowsFromPayload(payload, fileName) {
  const rows = Array.isArray(payload) ? payload : payload?.reviews;
  if (!Array.isArray(rows)) {
    throw new Error(`${fileName}: tableau reviews requis`);
  }
  return rows.map((row, index) => ({
    ...row,
    _file: fileName,
    _index: index,
  }));
}

function loadReviews(inputPath) {
  const stat = fs.statSync(inputPath);
  const files = stat.isDirectory()
    ? fs.readdirSync(inputPath)
      .filter(name => name.endsWith('.json') && name !== 'manifest.json')
      .sort()
      .map(name => path.join(inputPath, name))
    : [inputPath];

  const rows = [];
  for (const file of files) {
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    rows.push(...reviewRowsFromPayload(payload, path.basename(file)));
  }

  const seen = new Set();
  for (const row of rows) {
    const ref = String(row.product_ref || '').trim();
    if (!ref) throw new Error(`${row._file}[${row._index}]: product_ref requis dans review`);
    if (seen.has(ref)) throw new Error(`product_ref dupliqué dans les reviews: ${ref}`);
    seen.add(ref);
  }
  return rows;
}

function loadTranslations(inputPath) {
  const stat = fs.statSync(inputPath);
  const files = stat.isDirectory()
    ? fs.readdirSync(inputPath)
      .filter(name => name.endsWith('.json') && name !== 'manifest.json')
      .sort()
      .map(name => path.join(inputPath, name))
    : [inputPath];

  const rows = [];
  for (const file of files) {
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    rows.push(...translationRowsFromPayload(payload, path.basename(file)));
  }

  const seen = new Set();
  for (const row of rows) {
    const ref = String(row.product_ref || '').trim();
    if (!ref) throw new Error(`${row._file}[${row._index}]: product_ref requis`);
    if (seen.has(ref)) throw new Error(`product_ref dupliqué dans les traductions: ${ref}`);
    seen.add(ref);
  }
  return rows;
}

async function loadCurrentRows(productRefs) {
  if (!productRefs.length) return [];
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
            p.lifecycle_status,
            p.is_active,
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
        AND p.product_ref = ANY($2::text[])
      ORDER BY p.product_ref`,
    [SUPPLIER, productRefs]
  );
  return rows;
}

function evaluateRow(sourceRow, translation, review) {
  const source = sourceDocumentFromRow(sourceRow);
  const actualHash = sourceFingerprint(source);
  const proposedHash = String(translation.source_hash || '').trim();
  const blocking = [];

  if (!proposedHash) blocking.push('source_hash_missing');
  else if (proposedHash !== actualHash) blocking.push('source_hash_mismatch');

  if (sourceRow.lifecycle_status !== 'candidate' || sourceRow.is_active === true) {
    blocking.push('product_not_inactive_candidate');
  }

  if (!catalogOverrides.isPipelineSourced(sourceRow)) {
    blocking.push('product_without_pipeline_source_lineage');
  }

  const sourceLocale = String(source.source_locale || '').trim().toLowerCase().replace('_', '-');
  if (!sourceLocale || sourceLocale === 'fr' || sourceLocale.startsWith('fr-')) {
    blocking.push('fr_quality_pass_requires_foreign_source');
  }

  const proposal = {
    title_fr: normalizeSpace(translation.title_fr),
    description_fr: normalizeSpace(translation.description_fr),
  };
  const quality = evaluateFrenchCopy(source, proposal);
  blocking.push(...quality.blocking);

  const expectedOutputHash = proposalFingerprint({
    source_hash: actualHash,
    title_fr: proposal.title_fr,
    description_fr: proposal.description_fr,
  });

  if (!review) {
    blocking.push('offline_review_missing');
  } else {
    if (String(review.source_hash || '').trim() !== actualHash) blocking.push('review_source_hash_mismatch');
    if (String(review.output_hash || '').trim() !== expectedOutputHash) blocking.push('review_output_hash_mismatch');
    if (String(review.review_status || '').trim().toUpperCase() !== 'PASS') blocking.push('offline_review_failed');
    if (!['assistant_second_pass', 'human'].includes(String(review.reviewer_mode || '').trim())) {
      blocking.push('reviewer_mode_invalid');
    }
  }

  return {
    ok: blocking.length === 0,
    product_ref: sourceRow.product_ref,
    source_hash: actualHash,
    proposal,
    blocking: [...new Set(blocking)],
    warnings: quality.warnings,
    diagnostics: quality.diagnostics,
    note: translation.note ? String(translation.note).slice(0, 500) : null,
    output_hash: expectedOutputHash,
    review_note: review?.review_note ? String(review.review_note).slice(0, 500) : null,
    reviewer_mode: review?.reviewer_mode || null,
  };
}

async function applyAccepted(q, sourceRow, verdict) {
  const result = await catalogOverrides.upsertOverrides(
    q,
    sourceRow.product_id,
    {
      name: verdict.proposal.title_fr,
      description: verdict.proposal.description_fr,
    },
    {
      reason: 'FR Quality Pass — traduction/réécriture assistée hors runtime, source vérifiée par hash',
      setBy: null,
    }
  );

  if (!result.product) throw new Error(`FR_QUALITY_APPLY_NO_PRODUCT:${sourceRow.product_ref}`);
  const finalized = await catalogOverrides.finalizeReviewedManualPreparation(q, sourceRow.product_id);
  if (finalized.is_active === true || finalized.lifecycle_status !== 'candidate') {
    throw new Error(`FR_QUALITY_SAFETY_LIFECYCLE:${sourceRow.product_ref}`);
  }
  if (finalized.content_source !== 'manual' || finalized.needs_review !== false) {
    throw new Error(`FR_QUALITY_MANUAL_PREPARATION_INCOMPLETE:${sourceRow.product_ref}`);
  }

  return {
    product_ref: sourceRow.product_ref,
    content_source: finalized.content_source,
    needs_review: finalized.needs_review,
    lifecycle_status: finalized.lifecycle_status,
    is_active: finalized.is_active,
  };
}

async function finalSafetyAudit(q = db) {
  const { rows: [row] } = await q.query(
    `SELECT COUNT(*) FILTER (WHERE p.is_active=TRUE)::int AS active,
            COUNT(DISTINCT pme.product_id)::int AS exposed,
            COUNT(*) FILTER (WHERE p.lifecycle_status IS DISTINCT FROM 'candidate')::int AS wrong_lifecycle
       FROM sourcing_candidates sc
       JOIN products p ON p.id=sc.product_id
       LEFT JOIN product_market_exposure pme ON pme.product_id=p.id
      WHERE sc.supplier_name=$1
        AND sc.state='imported_to_catalog'`,
    [SUPPLIER]
  );
  return {
    active: Number(row?.active || 0),
    exposed: Number(row?.exposed || 0),
    wrong_lifecycle: Number(row?.wrong_lifecycle || 0),
  };
}

async function run(options = parseArgs()) {
  assertDisposableRuntime();
  const translations = loadTranslations(options.input);
  const reviews = loadReviews(options.review);
  const reviewByRef = new Map(reviews.map(row => [String(row.product_ref).trim(), row]));
  const refs = translations.map(row => String(row.product_ref).trim());
  const current = await loadCurrentRows(refs);
  const byRef = new Map(current.map(row => [row.product_ref, row]));

  const accepted = [];
  const rejected = [];
  const applied = [];

  for (const translation of translations) {
    const ref = String(translation.product_ref).trim();
    const sourceRow = byRef.get(ref);
    if (!sourceRow) {
      rejected.push({ product_ref: ref, blocking: ['product_not_found'] });
      continue;
    }

    const verdict = evaluateRow(sourceRow, translation, reviewByRef.get(ref));
    if (!verdict.ok) {
      rejected.push(verdict);
      continue;
    }
    accepted.push(verdict);
  }

  let applyError = null;
  if (options.execute && rejected.length === 0) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      for (const verdict of accepted) {
        const sourceRow = byRef.get(verdict.product_ref);
        // eslint-disable-next-line no-await-in-loop
        applied.push(await applyAccepted(client, sourceRow, verdict));
      }
      const txSafety = await finalSafetyAudit(client);
      if (txSafety.active || txSafety.exposed || txSafety.wrong_lifecycle) {
        throw new Error(`FR_QUALITY_SAFETY_AUDIT_FAILED:${JSON.stringify(txSafety)}`);
      }
      await client.query('COMMIT');
    } catch (error) {
      applyError = String(error.message || error).slice(0, 500);
      await client.query('ROLLBACK').catch(() => {});
      applied.length = 0;
    } finally {
      client.release();
    }
  }

  const safety = await finalSafetyAudit();
  if (safety.active || safety.exposed || safety.wrong_lifecycle) {
    throw new Error(`FR_QUALITY_SAFETY_AUDIT_FAILED:${JSON.stringify(safety)}`);
  }

  const summary = {
    mode: options.execute ? 'execute' : 'dry-run',
    submitted: translations.length,
    reviews: reviews.length,
    found: current.length,
    accepted: accepted.length,
    rejected: rejected.length,
    applied: applied.length,
    transaction_status: applyError ? 'ROLLED_BACK' : (options.execute && rejected.length === 0 ? 'COMMITTED' : 'NOT_STARTED'),
    api_calls: 0,
    paid_ai_dependency: false,
    editorial_status: 'READY_FOR_HUMAN_PUBLICATION_REVIEW',
    safety,
  };

  const report = {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    authority: 'OFFLINE_AI_ASSISTED_COPY_READY_FOR_HUMAN_PUBLICATION_REVIEW',
    summary,
    accepted,
    rejected,
    applied,
    apply_error: applyError,
  };

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`[catalog-fr-quality-apply] ${JSON.stringify(summary)}`);

  if (rejected.length) {
    const error = new Error(`FR_QUALITY_REJECTED:${rejected.length}/${translations.length}`);
    error.report = report;
    throw error;
  }
  if (applyError) {
    const error = new Error(`FR_QUALITY_APPLY_ROLLED_BACK:${applyError}`);
    error.report = report;
    throw error;
  }
  return report;
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(`[catalog-fr-quality-apply] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  SUPPLIER,
  parseArgs,
  assertDisposableRuntime,
  translationRowsFromPayload,
  reviewRowsFromPayload,
  loadTranslations,
  loadReviews,
  evaluateRow,
  applyAccepted,
  finalSafetyAudit,
  run,
};
