#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          cj-fr-cold-start-challenge
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        disposable terminology-enriched checkpoint, CJ read-only product API
 * @outputs       100-product unseen FR translation challenge workpack + coverage report
 * @depends       db.js, services/suppliers/connectors/cj-connector.js, services/catalog-fr-quality.js, services/catalog-terminology-memory.js
 * @used-by       isolated-cj-fr-cold-start-challenge.yml
 * @db-read       sourcing_candidates, catalog_glossary, catalog_terminology_reference
 * @db-write      none
 * @db-txn        none
 * @doctrine      cold_start_translation_proof, unseen_supplier_ids, offline_ai_assistance, no_publication
 * @impact-areas  catalog, product-detail, staging
 * @version       2026-09-v1
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const cjConnector = require('../services/suppliers/connectors/cj-connector');
const { sourceFingerprint } = require('../services/catalog-fr-quality');
const { loadTerminologyHints, normalizeTerm } = require('../services/catalog-terminology-memory');
const {
  translationContract,
  reviewContract,
} = require('./catalog-fr-quality-workpack');

const SUPPLIER = 'CJdropshipping';
const FLAG = 'KOMERCE_ALLOW_CJ_FR_COLD_START_CHALLENGE';
const DEFAULT_TARGET = 100;
const MAX_TARGET = 200;
const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 30;
const DEFAULT_POOL_MULTIPLIER = 3;
const DETAIL_CHUNK = 20;
const DEFAULT_DETAIL_DELAY_MS = 1100;
const DEFAULT_QUOTA_WAIT_MS = 60000;
const DEFAULT_MAX_QUOTA_WAITS = 20;

function intValue(value, fallback, min, max, label) {
  if (value == null || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} doit être un entier entre ${min} et ${max}`);
  }
  return parsed;
}

function isTruthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function parseArgs(argv = process.argv.slice(2)) {
  let mode = 'discover';
  let target = DEFAULT_TARGET;
  let maxPages = DEFAULT_MAX_PAGES;
  let rawDir = path.resolve('artifacts/cj-fr-cold-start/raw');
  let outputDir = path.resolve('artifacts/cj-fr-cold-start/enriched');

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode') mode = String(argv[++i] || '').trim();
    else if (arg.startsWith('--mode=')) mode = String(arg.split('=', 2)[1] || '').trim();
    else if (arg === '--target') target = intValue(argv[++i], DEFAULT_TARGET, 1, MAX_TARGET, '--target');
    else if (arg.startsWith('--target=')) target = intValue(arg.split('=', 2)[1], DEFAULT_TARGET, 1, MAX_TARGET, '--target');
    else if (arg === '--max-pages') maxPages = intValue(argv[++i], DEFAULT_MAX_PAGES, 1, 100, '--max-pages');
    else if (arg.startsWith('--max-pages=')) maxPages = intValue(arg.split('=', 2)[1], DEFAULT_MAX_PAGES, 1, 100, '--max-pages');
    else if (arg === '--raw-dir') rawDir = path.resolve(String(argv[++i] || '').trim());
    else if (arg.startsWith('--raw-dir=')) rawDir = path.resolve(String(arg.split('=', 2)[1] || '').trim());
    else if (arg === '--output-dir') outputDir = path.resolve(String(argv[++i] || '').trim());
    else if (arg.startsWith('--output-dir=')) outputDir = path.resolve(String(arg.split('=', 2)[1] || '').trim());
    else throw new Error(`Argument inconnu: ${arg}`);
  }

  if (!['discover', 'enrich'].includes(mode)) throw new Error('--mode doit être discover ou enrich');
  return { mode, target, maxPages, rawDir, outputDir };
}

function assertDisposableRuntime(env = process.env, { requireCj = false } = {}) {
  if (String(env.KOMERCE_ENV || '').trim().toLowerCase() !== 'staging' || env.NODE_ENV !== 'test') {
    throw new Error('REFUS: KOMERCE_ENV=staging et NODE_ENV=test requis');
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  const url = new URL(env.DATABASE_URL);
  const dbName = String(url.pathname || '').replace(/^\//, '');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || dbName !== 'komerce_real_catalog_stress') {
    throw new Error('REFUS: base jetable localhost komerce_real_catalog_stress requise');
  }
  if (requireCj) {
    if (!isTruthy(env[FLAG])) throw new Error(`REFUS: ${FLAG}=1 requis`);
    if (!env.CJ_ACCESS_TOKEN && !env.CJ_API_KEY) {
      throw new Error('CJ_ACCESS_TOKEN ou CJ_API_KEY requis');
    }
  }
}

function isQuotaError(error) {
  return /(?:HTTP\s*)?429|insufficient api points|16900500|too many requests|rate.?limit/i.test(
    String(error?.message || error || '')
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function categoryBucket(product = {}) {
  const raw = String(product.supplier_category || '').trim();
  if (!raw) return '<unknown>';
  return raw.split(/\s*>\s*|\s*\/\s*/)[0].trim().toLowerCase() || '<unknown>';
}

function stableScore(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function selectDiverseCandidates(candidates, target) {
  const groups = new Map();
  for (const product of candidates) {
    const key = categoryBucket(product);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(product);
  }
  for (const values of groups.values()) {
    values.sort((a, b) => stableScore(a.supplier_product_id).localeCompare(stableScore(b.supplier_product_id)));
  }

  const keys = [...groups.keys()].sort((a, b) => stableScore(a).localeCompare(stableScore(b)));
  const selected = [];
  let round = 0;
  while (selected.length < target) {
    let added = 0;
    for (const key of keys) {
      const item = groups.get(key)?.[round];
      if (!item) continue;
      selected.push(item);
      added += 1;
      if (selected.length >= target) break;
    }
    if (!added) break;
    round += 1;
  }
  return selected;
}

async function loadSeenIds() {
  const { rows } = await db.query(
    `SELECT supplier_product_id
       FROM sourcing_candidates
      WHERE supplier_name=$1
        AND supplier_product_id IS NOT NULL`,
    [SUPPLIER]
  );
  return new Set(rows.map(row => String(row.supplier_product_id || '').trim()).filter(Boolean));
}

async function withQuotaRetry(fn, {
  label,
  waitMs = DEFAULT_QUOTA_WAIT_MS,
  maxWaits = DEFAULT_MAX_QUOTA_WAITS,
  state,
} = {}) {
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      if (state.quotaWaits >= maxWaits) {
        throw new Error(`CJ_QUOTA_WAIT_BUDGET_EXHAUSTED label=${label} waits=${state.quotaWaits}`);
      }
      state.quotaWaits += 1;
      console.log(`[cj-fr-cold-start] quota_wait=${state.quotaWaits} label=${label} wait_ms=${waitMs}`);
      await sleep(waitMs);
    }
  }
}

async function discoverCandidatePool(seen, {
  target,
  maxPages,
  env = process.env,
  state,
} = {}) {
  const poolTarget = Math.min(1000, Math.max(target, target * DEFAULT_POOL_MULTIPLIER));
  const byId = new Map();
  let page = 1;

  while (page <= maxPages && byId.size < poolTarget) {
    // eslint-disable-next-line no-await-in-loop
    const result = await withQuotaRetry(
      () => cjConnector.fetchProducts({ page, size: PAGE_SIZE, env }),
      { label: `list-page-${page}`, state }
    );
    state.listCalls += 1;

    for (const product of result.products || []) {
      const id = String(product?.supplier_product_id || '').trim();
      if (!id || seen.has(id) || byId.has(id)) continue;
      if (!String(product.product_name || '').trim()) continue;
      byId.set(id, product);
    }

    const announced = Number(result.total_records || 0);
    const totalPages = announced > 0 ? Math.ceil(announced / PAGE_SIZE) : null;
    if (totalPages !== null && page >= totalPages) break;
    page += 1;
  }

  return {
    products: [...byId.values()],
    pages_scanned: Math.min(page, maxPages),
  };
}

async function hydrateExactProducts(candidates, seen, target, {
  env = process.env,
  state,
  delayMs = DEFAULT_DETAIL_DELAY_MS,
} = {}) {
  const exact = [];
  const errors = [];
  const accessToken = await cjConnector.getAccessToken({ env });

  for (let index = 0; index < candidates.length && exact.length < target; index += 1) {
    const candidate = candidates[index];
    const id = String(candidate?.supplier_product_id || '').trim();
    if (!id || seen.has(id)) continue;

    if (state.detailCalls > 0 && delayMs > 0) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(delayMs);
    }

    try {
      // Exact /product/query read. We deliberately do not import the product.
      // eslint-disable-next-line no-await-in-loop
      const detail = await withQuotaRetry(
        () => cjConnector.fetchProductDetail(id, { env, accessToken }),
        { label: `detail-${id}`, state }
      );
      state.detailCalls += 1;
      const product = cjConnector.normalizeCjProduct(detail.product);
      const normalizedId = String(product?.supplier_product_id || '').trim();

      if (normalizedId !== id) {
        errors.push({
          supplier_product_id: id,
          error: `DETAIL_ID_MISMATCH actual=${normalizedId || '<missing>'}`,
        });
        continue;
      }
      if (!String(product.product_name || '').trim()) {
        errors.push({ supplier_product_id: id, error: 'DETAIL_TITLE_MISSING' });
        continue;
      }
      if (exact.some(item => item.supplier_product_id === normalizedId)) continue;
      exact.push(product);
    } catch (error) {
      state.detailCalls += 1;
      errors.push({
        supplier_product_id: id,
        error: String(error?.message || error).slice(0, 300),
      });
    }
  }

  return { products: exact, errors };
}

function buildSource(product, index) {
  const ref = `COLD-${String(index + 1).padStart(3, '0')}`;
  return {
    product_ref: ref,
    supplier_name: SUPPLIER,
    supplier_product_id: String(product.supplier_product_id || '').trim(),
    source_locale: String(product.source_locale || 'en').trim() || 'en',
    title: String(product.product_name || '').replace(/\s+/g, ' ').trim(),
    description: product.description || null,
    supplier_category: product.supplier_category || null,
    current_category: null,
    current_subcategory: null,
    brand: product.brand || null,
    highlights: Array.isArray(product.highlights) ? product.highlights.slice(0, 20) : null,
    specifications: Array.isArray(product.specifications) ? product.specifications.slice(0, 20) : null,
    materials: Array.isArray(product.materials) ? product.materials.slice(0, 20) : null,
    care: Array.isArray(product.care) ? product.care.slice(0, 20) : null,
    warnings: Array.isArray(product.warnings) ? product.warnings.slice(0, 20) : null,
    option_axes: Array.isArray(product.option_axes) ? product.option_axes.slice(0, 12) : null,
  };
}

function challengeContract() {
  return {
    purpose: 'Prouver le comportement cold-start sur 100 produits fournisseur jamais vus par le checkpoint de référence.',
    acceptance: {
      unseen_supplier_ids: '100/100',
      translation_inputs_ready: '100/100',
      paid_runtime_ai_calls: 0,
      publication_or_exposure: 0,
      critical_inventions_after_translation_review: 0,
      silent_critical_omissions_after_translation_review: 0,
      missing_glossary_or_termium_may_block_processing: false,
      second_pass_review_required: true,
    },
    fallback_chain: [
      'catalog_glossary (autorité Komerce si terme déjà validé)',
      'catalog_terminology_reference / TERMIUM (référence contextuelle, non autoritaire)',
      'traduction raisonnée à partir de la source originale',
      'si ambiguïté réelle: note/review explicite, jamais invention silencieuse',
      'après validation: nouveau terme récurrent promu explicitement dans catalog_glossary',
    ],
  };
}

function writeWorkpack(entries, outputDir, {
  phase,
  batchSize = 40,
  discovery = null,
  coverage = null,
} = {}) {
  fs.mkdirSync(outputDir, { recursive: true });
  const batches = [];

  for (let offset = 0; offset < entries.length; offset += batchSize) {
    const batchNo = Math.floor(offset / batchSize) + 1;
    const products = entries.slice(offset, offset + batchSize);
    const file = `batch-${String(batchNo).padStart(3, '0')}.json`;
    fs.writeFileSync(path.join(outputDir, file), JSON.stringify({
      schema_version: 1,
      challenge: 'CJ_FR_COLD_START',
      phase,
      batch_number: batchNo,
      batch_size: products.length,
      translation_contract: translationContract(),
      products,
    }, null, 2) + '\n');
    batches.push({ batch_number: batchNo, file, products: products.length });
  }

  const manifest = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    challenge: 'CJ_FR_COLD_START',
    phase,
    supplier: SUPPLIER,
    total_products: entries.length,
    api_calls_paid_ai: 0,
    challenge_contract: challengeContract(),
    translation_contract: translationContract(),
    review_contract: reviewContract(),
    discovery,
    coverage,
    batches,
  };
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

function readWorkpackEntries(rawDir) {
  const files = fs.readdirSync(rawDir)
    .filter(name => /^batch-\d+\.json$/i.test(name))
    .sort();
  const entries = [];
  for (const file of files) {
    const payload = JSON.parse(fs.readFileSync(path.join(rawDir, file), 'utf8'));
    entries.push(...(payload.products || []));
  }
  return entries;
}

function summarizeCoverage(entries) {
  const externalTerms = new Map();
  let productsWithCurated = 0;
  let productsWithExternal = 0;
  let curatedHits = 0;
  let externalHits = 0;

  for (const entry of entries) {
    const curated = entry.terminology_hints?.curated || [];
    const refs = entry.terminology_hints?.references || [];
    if (curated.length) productsWithCurated += 1;
    if (refs.length) productsWithExternal += 1;
    curatedHits += curated.length;
    externalHits += refs.length;

    const productSeenTerms = new Set();
    for (const ref of refs) {
      const key = normalizeTerm(ref.term_en);
      if (!key) continue;
      if (!externalTerms.has(key)) {
        externalTerms.set(key, {
          term_en: ref.term_en,
          translations: new Set(),
          domains: new Set(),
          product_refs: new Set(),
        });
      }
      const item = externalTerms.get(key);
      item.translations.add(String(ref.term_fr || '').trim());
      if (ref.dataset_domain) item.domains.add(ref.dataset_domain);
      if (!productSeenTerms.has(key)) item.product_refs.add(entry.product_ref);
      productSeenTerms.add(key);
    }
  }

  const glossaryCandidates = [...externalTerms.values()]
    .map(item => ({
      term_en: item.term_en,
      product_count: item.product_refs.size,
      ambiguous: item.translations.size > 1,
      translations: [...item.translations].filter(Boolean).sort(),
      domains: [...item.domains].filter(Boolean).sort(),
    }))
    .sort((a, b) =>
      b.product_count - a.product_count
      || Number(b.ambiguous) - Number(a.ambiguous)
      || a.term_en.localeCompare(b.term_en)
    );

  return {
    total_products: entries.length,
    translation_inputs_ready: entries.filter(entry =>
      entry.source_hash
      && String(entry.source?.title || '').trim()
      && String(entry.source?.supplier_product_id || '').trim()
    ).length,
    products_with_curated_glossary: productsWithCurated,
    products_with_external_reference: productsWithExternal,
    products_without_any_terminology_hint: entries.filter(entry =>
      !(entry.terminology_hints?.curated || []).length
      && !(entry.terminology_hints?.references || []).length
    ).length,
    curated_hits: curatedHits,
    external_reference_hits: externalHits,
    unique_external_english_terms: externalTerms.size,
    ambiguous_external_terms: [...externalTerms.values()].filter(item => item.translations.size > 1).length,
    glossary_candidates: glossaryCandidates,
  };
}

async function discover(options, env = process.env) {
  assertDisposableRuntime(env, { requireCj: true });

  const state = {
    listCalls: 0,
    detailCalls: 0,
    quotaWaits: 0,
  };
  const seen = await loadSeenIds();
  const pool = await discoverCandidatePool(seen, {
    target: options.target,
    maxPages: options.maxPages,
    env,
    state,
  });
  const selected = selectDiverseCandidates(pool.products, Math.min(pool.products.length, options.target * 2));
  const exact = await hydrateExactProducts(selected, seen, options.target, { env, state });

  if (exact.products.length !== options.target) {
    throw new Error(
      `COLD_START_TARGET_NOT_REACHED exact=${exact.products.length}/${options.target} pool=${pool.products.length}`
    );
  }

  const entries = exact.products.map((product, index) => {
    const source = buildSource(product, index);
    return {
      product_ref: source.product_ref,
      supplier_name: SUPPLIER,
      supplier_product_id: source.supplier_product_id,
      source_hash: sourceFingerprint(source),
      unseen_against_checkpoint: !seen.has(source.supplier_product_id),
      source,
    };
  });

  const duplicateIds = entries.length - new Set(entries.map(entry => entry.supplier_product_id)).size;
  const seenViolations = entries.filter(entry => !entry.unseen_against_checkpoint).length;
  if (duplicateIds || seenViolations) {
    throw new Error(`COLD_START_UNSEEN_INVARIANT_FAILED duplicates=${duplicateIds} seen=${seenViolations}`);
  }

  const discovery = {
    checkpoint_seen_supplier_ids: seen.size,
    target: options.target,
    candidate_pool: pool.products.length,
    selected_for_detail_attempts: selected.length,
    exact_products: entries.length,
    unseen_products: entries.filter(entry => entry.unseen_against_checkpoint).length,
    distinct_supplier_categories: new Set(entries.map(entry => categoryBucket(entry.source))).size,
    list_calls: state.listCalls,
    detail_calls: state.detailCalls,
    quota_waits: state.quotaWaits,
    detail_errors: exact.errors.length,
    pages_scanned: pool.pages_scanned,
  };
  const manifest = writeWorkpack(entries, options.rawDir, { phase: 'raw_source', discovery });
  console.log(`[cj-fr-cold-start] DISCOVER ${JSON.stringify(discovery)}`);
  return manifest;
}

async function enrich(options) {
  assertDisposableRuntime(process.env, { requireCj: false });
  const rawEntries = readWorkpackEntries(options.rawDir);
  if (rawEntries.length !== options.target) {
    throw new Error(`COLD_START_RAW_COUNT_MISMATCH expected=${options.target} actual=${rawEntries.length}`);
  }

  const entries = [];
  for (const entry of rawEntries) {
    // eslint-disable-next-line no-await-in-loop
    const hints = await loadTerminologyHints(db, entry.source);
    entries.push({ ...entry, terminology_hints: hints });
  }

  const coverage = summarizeCoverage(entries);
  if (coverage.translation_inputs_ready !== options.target) {
    throw new Error(
      `COLD_START_INPUT_NOT_READY ready=${coverage.translation_inputs_ready}/${options.target}`
    );
  }

  fs.mkdirSync(options.outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(options.outputDir, 'glossary-candidates.json'),
    JSON.stringify({
      schema_version: 1,
      generated_at: new Date().toISOString(),
      authority: 'SUGGESTIONS_ONLY_REQUIRES_KOMERCE_VALIDATION',
      candidates: coverage.glossary_candidates,
    }, null, 2) + '\n'
  );

  const publicCoverage = { ...coverage };
  delete publicCoverage.glossary_candidates;
  const manifest = writeWorkpack(entries, options.outputDir, {
    phase: 'terminology_enriched',
    coverage: publicCoverage,
  });
  console.log(`[cj-fr-cold-start] ENRICH ${JSON.stringify(publicCoverage)}`);
  return manifest;
}

async function run(options = parseArgs(), env = process.env) {
  if (options.mode === 'discover') return discover(options, env);
  return enrich(options);
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(`[cj-fr-cold-start] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  SUPPLIER,
  FLAG,
  DEFAULT_TARGET,
  MAX_TARGET,
  PAGE_SIZE,
  DETAIL_CHUNK,
  parseArgs,
  assertDisposableRuntime,
  isQuotaError,
  categoryBucket,
  stableScore,
  selectDiverseCandidates,
  buildSource,
  challengeContract,
  summarizeCoverage,
  run,
};
