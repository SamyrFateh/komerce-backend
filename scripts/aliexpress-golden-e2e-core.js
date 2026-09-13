#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          aliexpress-golden-e2e-staging-worker
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        AliExpress live search/detail, staging DB, exact supplier product id for import
 * @outputs       one unseen source-qualified Golden candidate, or one canonical sourcing candidate import
 * @depends       db.js, scripts/aliexpress-500-catalog-sync.js, services/suppliers/connectors/aliexpress-connected-connector.js, services/suppliers/connectors/aliexpress-connector.js, services/suppliers/catalog-import-orchestrator.js
 * @used-by       scripts/aliexpress-prepayment-proof.js Railway one-shot router
 * @db-read       sourcing_candidates
 * @db-write-via:catalog-import-orchestrator supplier_catalog_imports, sourcing_candidates, sourcing_candidate_events
 * @db-txn        canonical import owners only
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md, docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md, docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md
 * @impact-areas  catalog, sourcing, supplier-integration, staging
 * @version       2026-09-golden-e2e-v1
 */
'use strict';

const db = require('../db');
const connected = require('../services/suppliers/connectors/aliexpress-connected-connector');
const baseConnector = require('../services/suppliers/connectors/aliexpress-connector');
const catalogImportOrchestrator = require('../services/suppliers/catalog-import-orchestrator');
const pool = require('./aliexpress-500-catalog-sync');

const SUPPLIER_NAME = 'AliExpress';
const ALLOW_FLAG = 'KOMERCE_ALLOW_ALIEXPRESS_GOLDEN_E2E';
const DEFAULT_QUERY = 'usb c fast charging cable';
const DEFAULT_COUNTRY_CODE = 'AE';
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 5;
const DEFAULT_MIN_UNITS = 2;
const DEFAULT_MIN_MEDIA = 2;
const SEARCH_METHOD = 'aliexpress.ds.text.search';

function runtime(env = process.env) {
  return String(env.KOMERCE_ENV || env.NODE_ENV || '').trim().toLowerCase() || 'unknown';
}

function assertStaging(env = process.env) {
  const rt = runtime(env);
  if (rt !== 'staging') throw new Error(`REFUS: KOMERCE_ENV=staging requis (reçu: ${rt})`);
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  return rt;
}

function positiveInt(value, fallback, min, max, label) {
  if (value == null || value === '') return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${label} doit être un entier ${min}..${max}`);
  }
  return n;
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  const exactArg = argv.find((arg) => arg.startsWith('--supplier-product-id='));
  const supplierProductId = exactArg ? exactArg.slice('--supplier-product-id='.length).trim() : null;
  const executeImport = args.has('--execute-import');
  const dryRun = args.has('--dry-run') || !executeImport;
  if (executeImport && dryRun && args.has('--dry-run')) {
    throw new Error('--dry-run et --execute-import sont mutuellement exclusifs');
  }
  if (executeImport && !/^\d{5,20}$/.test(String(supplierProductId || ''))) {
    throw new Error('--execute-import exige --supplier-product-id=<id AliExpress exact>');
  }
  return { mode: executeImport ? 'import' : 'dry-run', supplierProductId };
}

function validOrderIdentity(identity) {
  if (!identity || String(identity.provider || '').toLowerCase() !== 'aliexpress') return false;
  const payload = identity.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const skuId = String(payload.sku_id || '').trim();
  const skuAttr = String(payload.sku_attr || '').trim();
  return Boolean(skuId || skuAttr);
}

function identityAudit(product) {
  const units = Array.isArray(product?.sellable_units) ? product.sellable_units : [];
  const active = units.filter((unit) => unit?.is_active !== false);
  const inStock = active.filter((unit) => Number(unit?.stock_available) > 0);
  const complete = inStock.filter((unit) =>
    Boolean(String(unit?.supplier_sku || '').trim())
    && Boolean(String(unit?.supplier_unit_ref || '').trim())
    && validOrderIdentity(unit?.supplier_order_identity)
  );
  return {
    units: units.length,
    active_units: active.length,
    in_stock_units: inStock.length,
    complete_order_identity_units: complete.length,
    complete: inStock.length > 0 && complete.length === inStock.length,
  };
}

function mediaCount(product) {
  return Array.isArray(product?.media)
    ? product.media.filter((item) => /^https:\/\//i.test(String(item?.url || ''))).length
    : 0;
}

function sourceQualified(product, { minUnits = DEFAULT_MIN_UNITS, minMedia = DEFAULT_MIN_MEDIA } = {}) {
  if (!pool.basicCleanProduct(product)) return false;
  const audit = identityAudit(product);
  return audit.complete
    && audit.in_stock_units >= minUnits
    && mediaCount(product) >= minMedia;
}

function selectGoldenProduct(products, seenIds, options = {}) {
  const seen = seenIds instanceof Set ? seenIds : new Set(seenIds || []);
  for (const product of products || []) {
    const id = String(product?.supplier_product_id || '').trim();
    if (!id || seen.has(id)) continue;
    if (!sourceQualified(product, options)) continue;
    return product;
  }
  return null;
}

async function loadSeenSupplierIds(q = db) {
  const { rows } = await q.query(
    `SELECT supplier_product_id
       FROM sourcing_candidates
      WHERE supplier_name = $1
        AND supplier_product_id IS NOT NULL`,
    [SUPPLIER_NAME]
  );
  return new Set(rows.map((row) => String(row.supplier_product_id || '').trim()).filter(Boolean));
}

function discoveryConfig(env = process.env) {
  return {
    query: String(env.KOMERCE_ALIEXPRESS_GOLDEN_QUERY || DEFAULT_QUERY).trim() || DEFAULT_QUERY,
    countryCode: pool.normalizeCountryCode(env.KOMERCE_ALIEXPRESS_GOLDEN_COUNTRY_CODE || DEFAULT_COUNTRY_CODE),
    pageSize: positiveInt(env.KOMERCE_ALIEXPRESS_GOLDEN_PAGE_SIZE, DEFAULT_PAGE_SIZE, 1, 50, 'KOMERCE_ALIEXPRESS_GOLDEN_PAGE_SIZE'),
    maxPages: positiveInt(env.KOMERCE_ALIEXPRESS_GOLDEN_MAX_PAGES, DEFAULT_MAX_PAGES, 1, 20, 'KOMERCE_ALIEXPRESS_GOLDEN_MAX_PAGES'),
    minUnits: positiveInt(env.KOMERCE_ALIEXPRESS_GOLDEN_MIN_UNITS, DEFAULT_MIN_UNITS, 1, 100, 'KOMERCE_ALIEXPRESS_GOLDEN_MIN_UNITS'),
    minMedia: positiveInt(env.KOMERCE_ALIEXPRESS_GOLDEN_MIN_MEDIA, DEFAULT_MIN_MEDIA, 1, 50, 'KOMERCE_ALIEXPRESS_GOLDEN_MIN_MEDIA'),
  };
}

async function fetchExactProduct(supplierProductId, providerEnv, config) {
  const fetched = await pool.fetchProductsRateLimited([supplierProductId], {
    countryCode: config.countryCode,
    providerEnv,
    detailDelayMs: 0,
    detailRetryAttempts: pool.DEFAULT_DETAIL_RETRY_ATTEMPTS,
  });
  const product = (fetched.products || []).find((item) => String(item.supplier_product_id) === String(supplierProductId));
  if (!product) throw new Error(`AliExpress live n'a pas renvoyé ${supplierProductId}`);
  return product;
}

async function discoverOne(providerEnv, config, seenIds) {
  const inspected = [];
  for (let page = 1; page <= config.maxPages; page += 1) {
    const payload = await baseConnector.invokeTop(SEARCH_METHOD, {
      keyword: config.query,
      countryCode: config.countryCode,
      currency: 'USD',
      local: 'en_US',
      page_size: config.pageSize,
      page_index: page,
      sort: 'salesDesc',
    }, { env: providerEnv });
    const ids = pool.textSearchProductIds(payload).filter((id) => !seenIds.has(id));
    const batch = ids.slice(0, Math.min(ids.length, 8));
    if (!batch.length) continue;
    const fetched = await pool.fetchProductsRateLimited(batch, {
      countryCode: config.countryCode,
      providerEnv,
      detailDelayMs: 250,
      detailRetryAttempts: pool.DEFAULT_DETAIL_RETRY_ATTEMPTS,
    });
    for (const product of fetched.products || []) {
      const audit = identityAudit(product);
      inspected.push({
        supplier_product_id: product.supplier_product_id,
        units: audit.units,
        in_stock_units: audit.in_stock_units,
        identity_units: audit.complete_order_identity_units,
        media: mediaCount(product),
      });
    }
    const selected = selectGoldenProduct(fetched.products, seenIds, {
      minUnits: config.minUnits,
      minMedia: config.minMedia,
    });
    if (selected) return { selected, page, inspected };
  }
  const error = new Error(`Aucun produit AliExpress neuf qualifié trouvé pour « ${config.query} » sur ${config.maxPages} page(s)`);
  error.inspected = inspected.slice(-20);
  throw error;
}

function withGoldenProvenance(product, config) {
  return {
    ...product,
    raw_payload: {
      ...(product.raw_payload || {}),
      discovery: {
        ...(product.raw_payload?.discovery || {}),
        source: 'aliexpress.golden.e2e',
        query: config.query,
        supplier_destination_country: config.countryCode,
        purpose: 'GOLDEN_E2E',
      },
    },
  };
}

function sourceSummary(product) {
  const audit = identityAudit(product);
  return {
    supplier_product_id: product.supplier_product_id,
    product_name: product.product_name,
    purchase_price: product.purchase_price,
    currency: product.currency,
    stock_available: product.stock_available,
    media_count: mediaCount(product),
    option_axes: Array.isArray(product.option_axes) ? product.option_axes.length : 0,
    ...audit,
  };
}

async function readCandidate(supplierProductId, q = db) {
  const { rows: [row] } = await q.query(
    `SELECT id, state, product_id, supplier_product_id, product_name,
            purchase_price, currency, komerce_category, scan_result,
            normalized_source_contract, rejected_reason, updated_at
       FROM sourcing_candidates
      WHERE supplier_name = $1 AND supplier_product_id = $2
      ORDER BY updated_at DESC
      LIMIT 1`,
    [SUPPLIER_NAME, supplierProductId]
  );
  return row || null;
}

function candidateSummary(candidate) {
  const scan = candidate?.scan_result || {};
  const contract = candidate?.normalized_source_contract || {};
  const units = Array.isArray(contract.sellable_units) ? contract.sellable_units : [];
  return {
    candidate_id: candidate?.id || null,
    state: candidate?.state || null,
    product_id: candidate?.product_id || null,
    supplier_product_id: candidate?.supplier_product_id || null,
    product_name: candidate?.product_name || null,
    purchase_price: candidate?.purchase_price ?? null,
    currency: candidate?.currency || null,
    komerce_category: candidate?.komerce_category || null,
    sourcing_decision: scan.sourcing_decision || null,
    recommended_price_kmf: scan.recommended_price_kmf ?? null,
    test_price_kmf: scan.test_price_kmf ?? null,
    eligibility: scan.eligibility || null,
    normalized_sellable_units: units.length,
    rejected_reason: candidate?.rejected_reason || null,
  };
}

async function dryRun(env = process.env) {
  const rt = assertStaging(env);
  const config = discoveryConfig(env);
  const seen = await loadSeenSupplierIds();
  const providerEnv = await connected.managedRuntimeEnv({ env });
  const { selected, page, inspected } = await discoverOne(providerEnv, config, seen);
  const output = {
    mode: 'dry-run',
    runtime: rt,
    writes: false,
    query: config.query,
    search_page: page,
    already_known_supplier_ids: seen.size,
    selected: sourceSummary(selected),
    inspected,
    next_gate: {
      action: 'IMPORT_EXACT_PRODUCT',
      supplier_product_id: selected.supplier_product_id,
      requires: `${ALLOW_FLAG}=1`,
      promotion: 'NOT_PERFORMED',
      place_order: 'HARD_STOP',
    },
  };
  console.log(`[aliexpress-golden-e2e] ${JSON.stringify(output)}`);
  return output;
}

async function executeImport(supplierProductId, env = process.env) {
  const rt = assertStaging(env);
  if (env[ALLOW_FLAG] !== '1') throw new Error(`${ALLOW_FLAG}=1 requis pour --execute-import`);
  const config = discoveryConfig(env);
  const existing = await readCandidate(supplierProductId);
  if (existing) throw new Error(`REFUS: supplier_product_id ${supplierProductId} déjà connu (candidate=${existing.id}, state=${existing.state})`);

  const providerEnv = await connected.managedRuntimeEnv({ env });
  const live = await fetchExactProduct(supplierProductId, providerEnv, config);
  if (!sourceQualified(live, { minUnits: config.minUnits, minMedia: config.minMedia })) {
    throw new Error(`REFUS: ${supplierProductId} ne satisfait plus le gate source Golden au moment de l'import`);
  }
  const product = withGoldenProvenance(live, config);
  const body = {
    supplier_name: SUPPLIER_NAME,
    source_type: 'api',
    source_filename: `aliexpress-golden-e2e/${supplierProductId}.json`,
    notes: `Golden E2E staging — exact AliExpress product ${supplierProductId}`,
    is_full_snapshot: false,
  };
  const dispatchOne = async () => ({ products: [product], invalid: [], total: 1 });
  const result = await catalogImportOrchestrator.importCatalog(body, null, dispatchOne);
  if (result.status !== 200 || Number(result.body?.accepted || 0) !== 1 || Number(result.body?.rejected || 0) !== 0) {
    throw new Error(`Import Golden refusé/incomplet: ${JSON.stringify(result.body).slice(0,1200)}`);
  }
  const candidate = await readCandidate(supplierProductId);
  if (!candidate) throw new Error(`Import accepté mais candidat ${supplierProductId} introuvable`);
  const summary = candidateSummary(candidate);
  const blocked = candidate.state === 'rejected' || summary.sourcing_decision === 'EXCLUDED';
  const output = {
    mode: 'import',
    runtime: rt,
    imported: true,
    source: sourceSummary(live),
    import: result.body,
    candidate: summary,
    next_gate: blocked
      ? { action: 'STOP', reason: 'SOURCE_OR_ELIGIBILITY_REJECTED' }
      : {
          action: 'EXPLICIT_PRICE_DECISION_REQUIRED',
          recommended_price_kmf: summary.recommended_price_kmf,
          test_price_kmf: summary.test_price_kmf,
          promotion: 'NOT_PERFORMED',
          place_order: 'HARD_STOP',
        },
  };
  console.log(`[aliexpress-golden-e2e] ${JSON.stringify(output)}`);
  return output;
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  return args.mode === 'import'
    ? executeImport(args.supplierProductId, env)
    : dryRun(env);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(`[aliexpress-golden-e2e] FAILED: ${error.stack || error}`);
      if (error.inspected) console.error(`[aliexpress-golden-e2e] inspected=${JSON.stringify(error.inspected)}`);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = {
  SUPPLIER_NAME,
  ALLOW_FLAG,
  DEFAULT_QUERY,
  DEFAULT_COUNTRY_CODE,
  DEFAULT_MIN_UNITS,
  DEFAULT_MIN_MEDIA,
  runtime,
  assertStaging,
  parseArgs,
  validOrderIdentity,
  identityAudit,
  mediaCount,
  sourceQualified,
  selectGoldenProduct,
  discoveryConfig,
  withGoldenProvenance,
  sourceSummary,
  candidateSummary,
  dryRun,
  executeImport,
  main,
};
