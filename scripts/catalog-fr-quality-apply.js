#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          catalog-french-quality-offline-apply
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        offline AI-assisted French translation JSON, disposable catalog checkpoint
 * @outputs       traced manual overrides + French quality audit report
 * @depends       db.js, services/catalog-overrides.js, services/catalog-fr-quality.js
 * @used-by       operator-assisted FR Quality Pass
 * @db-read       sourcing_candidates, products
 * @db-write-via  catalog-overrides
 * @db-txn        one product override sequence
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
  evaluateFrenchCopy,
  normalizeSpace,
} = require('../services/catalog-fr-quality');

const SUPPLIER = 'CJdropshipping';
const DEFAULT_REPORT = path.resolve('artifacts/catalog-fr-quality-apply-report.json');

function parseArgs(argv = process.argv.slice(2)) {
  let input = null;
  let execute = false;
  let output = DEFAULT_REPORT;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') input = path.resolve(String(argv[++i] || '').trim());
    else if (arg.startsWith('--input=')) input = path.resolve(String(arg.split('=', 2)[1] || '').trim());
    else if (arg === '--output') output = path.resolve(String(argv[++i] || '').trim());
    else if (arg.startsWith('--output=')) output = path.resolve(String(arg.split('=', 2)[1] || '').trim());
    else if (arg === '--execute') execute = true;
    else if (arg === '--dry-run') execute = false;
    else throw new Error(`Argument inconnu: ${arg}`);
  }

  if (!input) throw new Error('--input requis');
  return { input, execute, output };
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

function evaluateRow(sourceRow, translation) {
  const source = sourceDocumentFromRow(sourceRow);
  const actualHash = sourceFingerprint(source);
  const proposedHash = String(translation.source_hash || '').trim();
  const blocking = [];

  if (!proposedHash) blocking.push('source_hash_missing');
  else if (proposedHash !== actualHash) blocking.push('source_hash_mismatch');

  if (String(translation.review_status || '').trim().toUpperCase() !== 'PASS') {
    blocking.push('offline_review_missing_or_failed');
  }

  if (sourceRow.lifecycle_status !== 'candidate' || sourceRow.is_active === true) {
    blocking.push('product_not_inactive_candidate');
  }

  const proposal = {
    title_fr: normalizeSpace(translation.title_fr),
    description_fr: normalizeSpace(translation.description_fr),
  };
  const quality = evaluateFrenchCopy(source, proposal);
  blocking.push(...quality.blocking);

  return {
    ok: blocking.length === 0,
    product_ref: sourceRow.product_ref,
    source_hash: actualHash,
    proposal,
    blocking: [...new Set(blocking)],
    warnings: quality.warnings,
    diagnostics: quality.diagnostics,
    note: translation.note ? String(translation.note).slice(0, 500) : null,
    review_note: translation.review_note ? String(translation.review_note).slice(0, 500) : null,
  };
}

async function applyAccepted(sourceRow, verdict) {
  const result = await catalogOverrides.upsertOverrides(
    db,
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
  if (result.product.is_active === true || result.product.lifecycle_status !== 'candidate') {
    throw new Error(`FR_QUALITY_SAFETY_LIFECYCLE:${sourceRow.product_ref}`);
  }
  if (result.product.content_source !== 'manual' || result.product.needs_review !== false) {
    throw new Error(`FR_QUALITY_MANUAL_PREPARATION_INCOMPLETE:${sourceRow.product_ref}`);
  }

  return {
    product_ref: sourceRow.product_ref,
    content_source: result.product.content_source,
    needs_review: result.product.needs_review,
    lifecycle_status: result.product.lifecycle_status,
    is_active: result.product.is_active,
  };
}

async function finalSafetyAudit() {
  const { rows: [row] } = await db.query(
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

    const verdict = evaluateRow(sourceRow, translation);
    if (!verdict.ok) {
      rejected.push(verdict);
      continue;
    }
    accepted.push(verdict);

    if (options.execute) {
      // eslint-disable-next-line no-await-in-loop
      applied.push(await applyAccepted(sourceRow, verdict));
    }
  }

  const safety = await finalSafetyAudit();
  if (safety.active || safety.exposed || safety.wrong_lifecycle) {
    throw new Error(`FR_QUALITY_SAFETY_AUDIT_FAILED:${JSON.stringify(safety)}`);
  }

  const summary = {
    mode: options.execute ? 'execute' : 'dry-run',
    submitted: translations.length,
    found: current.length,
    accepted: accepted.length,
    rejected: rejected.length,
    applied: applied.length,
    api_calls: 0,
    paid_ai_dependency: false,
    safety,
  };

  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    authority: 'OFFLINE_AI_ASSISTED_MANUAL_COPY_WITH_STATIC_SOURCE_GATES',
    summary,
    accepted,
    rejected,
    applied,
  };

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`[catalog-fr-quality-apply] ${JSON.stringify(summary)}`);

  if (rejected.length) {
    const error = new Error(`FR_QUALITY_REJECTED:${rejected.length}/${translations.length}`);
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
  loadTranslations,
  evaluateRow,
  finalSafetyAudit,
  run,
};
