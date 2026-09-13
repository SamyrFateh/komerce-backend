#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          aliexpress-golden-e2e-semantic-owner
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        AliExpress live search/detail, staging DB, Golden query
 * @outputs       relevant unseen Golden candidate or guarded exact import
 * @depends       db.js, scripts/aliexpress-golden-e2e-core.js, scripts/aliexpress-golden-semantic.js, services/suppliers/connectors/aliexpress-connected-connector.js, services/suppliers/connectors/aliexpress-connector.js
 * @used-by       scripts/aliexpress-prepayment-proof.js Railway one-shot router
 * @db-read       sourcing_candidates
 * @db-write-via:aliexpress-golden-e2e-core catalog import owners only
 * @db-txn        delegated canonical owner
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md, docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md
 * @impact-areas  catalog, sourcing, supplier-integration, staging
 * @version       2026-09-golden-e2e-v2
 */
'use strict';

const db = require('../db');
const connected = require('../services/suppliers/connectors/aliexpress-connected-connector');
const baseConnector = require('../services/suppliers/connectors/aliexpress-connector');
const semantic = require('./aliexpress-golden-semantic');
const pool = require('./aliexpress-500-catalog-sync');
const core = require('./aliexpress-golden-e2e-core');

const SEARCH_METHOD = 'aliexpress.ds.text.search';

function semanticRelevance(product, query) {
  return semantic.audit(product, query);
}

function selectGoldenProduct(products, seenIds, options = {}) {
  const seen = seenIds instanceof Set ? seenIds : new Set(seenIds || []);
  for (const product of products || []) {
    const id = String(product?.supplier_product_id || '').trim();
    if (!id || seen.has(id)) continue;
    if (!core.sourceQualified(product, options)) continue;
    if (options.query && !semanticRelevance(product, options.query).relevant) continue;
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
    [core.SUPPLIER_NAME]
  );
  return new Set(rows.map((row) => String(row.supplier_product_id || '').trim()).filter(Boolean));
}

async function fetchExactProduct(supplierProductId, providerEnv, config) {
  const fetched = await pool.fetchProductsRateLimited([supplierProductId], {
    countryCode: config.countryCode,
    providerEnv,
    detailDelayMs: 0,
    detailRetryAttempts: pool.DEFAULT_DETAIL_RETRY_ATTEMPTS,
  });
  const product = (fetched.products || [])
    .find((item) => String(item.supplier_product_id) === String(supplierProductId));
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
      const identity = core.identityAudit(product);
      const relevance = semanticRelevance(product, config.query);
      inspected.push({
        supplier_product_id: product.supplier_product_id,
        units: identity.units,
        in_stock_units: identity.in_stock_units,
        identity_units: identity.complete_order_identity_units,
        media: core.mediaCount(product),
        relevant: relevance.relevant,
        matched_tokens: relevance.matched_tokens,
      });
    }
    const selected = selectGoldenProduct(fetched.products, seenIds, {
      minUnits: config.minUnits,
      minMedia: config.minMedia,
      query: config.query,
    });
    if (selected) return { selected, page, inspected };
  }
  const error = new Error(
    `Aucun produit AliExpress neuf qualifié ET pertinent trouvé pour « ${config.query} » sur ${config.maxPages} page(s)`
  );
  error.inspected = inspected.slice(-20);
  throw error;
}

async function dryRun(env = process.env) {
  const rt = core.assertStaging(env);
  const config = core.discoveryConfig(env);
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
    selected: {
      ...core.sourceSummary(selected),
      semantic_relevance: semanticRelevance(selected, config.query),
    },
    inspected,
    next_gate: {
      action: 'IMPORT_EXACT_PRODUCT',
      supplier_product_id: selected.supplier_product_id,
      requires: `${core.ALLOW_FLAG}=1`,
      promotion: 'NOT_PERFORMED',
      place_order: 'HARD_STOP',
    },
  };
  console.log(`[aliexpress-golden-e2e] ${JSON.stringify(output)}`);
  return output;
}

async function executeImport(supplierProductId, env = process.env) {
  core.assertStaging(env);
  const config = core.discoveryConfig(env);
  const providerEnv = await connected.managedRuntimeEnv({ env });
  const live = await fetchExactProduct(supplierProductId, providerEnv, config);
  const relevance = semanticRelevance(live, config.query);
  if (!relevance.relevant) {
    throw new Error(
      `REFUS: ${supplierProductId} hors sujet pour « ${config.query} » ` +
      `(matches=${relevance.matched_tokens.join(',') || '0'})`
    );
  }
  return core.executeImport(supplierProductId, env);
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const args = core.parseArgs(argv);
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
  ...core,
  semanticRelevance,
  selectGoldenProduct,
  dryRun,
  executeImport,
  main,
};
