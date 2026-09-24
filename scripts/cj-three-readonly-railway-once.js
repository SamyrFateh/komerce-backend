#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role          cj-three-readonly-railway-once
 * @domain        catalog
 * @layer         tooling
 * @owner         services/suppliers/connectors/cj-connector.js
 * @purpose       Bounded one-shot live CJ list + 3 exact detail reads on a temporary DB-less Railway worker.
 * @impact-areas  catalog, supplier-integration
 */
'use strict';

const cj = require('../services/suppliers/connectors/cj-connector');

const safeId = value => {
  const result = String(value || '').trim();
  return /^[A-Za-z0-9_-]{1,100}$/.test(result) ? result : null;
};
const safeText = value => String(value || '').replace(/[\r\n\t]/g, ' ').slice(0, 150);

function assertReadOnlyWorker(env = process.env) {
  if (env.KOMERCE_CJ_READONLY_ONCE !== '1') {
    throw new Error('CJ_READONLY_ONE_SHOT_NOT_ENABLED');
  }
  if (env.DATABASE_URL || env.DATABASE_PUBLIC_URL || env.PGHOST || env.PGUSER
      || env.RAILWAY_STAGING_DATABASE_URL || env.RAILWAY_DATABASE_URL) {
    throw new Error('CJ_READONLY_WORKER_MUST_HAVE_NO_DATABASE_CONNECTION');
  }
  if (!env.CJ_API_KEY && !env.CJ_ACCESS_TOKEN) {
    throw new Error('CJ_PROVIDER_CREDENTIAL_NOT_CONFIGURED');
  }
}

async function main() {
  assertReadOnlyWorker();
  // This does not use Railway backend/database APIs and never exports the
  // short-lived CJ access token. CJ_API_KEY comes from an intra-project
  // Railway reference variable; the provider token stays in this process.
  const source = await cj.fetchProducts({
    keyword: 'phone stand',
    page: 1,
    size: 12,
    env: process.env,
  });
  const exactIds = [...new Set((source.products || [])
    .map(p => safeId(p.supplier_product_id))
    .filter(Boolean))].slice(0, 3);
  if (exactIds.length !== 3) {
    throw new Error('CJ_FEWER_THAN_THREE_DISTINCT_LIST_IDS');
  }
  const details = await cj.fetchProducts({
    productIds: exactIds,
    detailDelayMs: 1100,
    detailRetries: 0,
    env: process.env,
  });
  if (details.invalid?.length || details.products?.length !== 3) {
    throw new Error('CJ_EXACT_DETAILS_INCOMPLETE');
  }
  const indexed = new Map(details.products.map(p => [safeId(p.supplier_product_id), p]));
  const products = exactIds.map(id => indexed.get(id));
  if (products.some(p => !p)) throw new Error('CJ_EXACT_DETAIL_IDENTITY_MISMATCH');
  const report = products.map(p => ({
    supplier: 'CJdropshipping',
    supplier_product_id: safeId(p.supplier_product_id),
    name: safeText(p.product_name),
    currency: p.currency || null,
    purchase_price: p.purchase_price ?? null,
    source_locale: p.source_locale || null,
    stock_available: p.stock_available ?? null,
    media_count: Array.isArray(p.media) ? p.media.length : 0,
    sellable_unit_count: Array.isArray(p.sellable_units) ? p.sellable_units.length : 0,
    order_identity_count: Array.isArray(p.sellable_units)
      ? p.sellable_units.filter(u => u?.supplier_order_identity && u?.supplier_unit_ref).length : 0,
  }));
  console.log('CJ_READONLY_THREE_EXACT_OFFERS ' + JSON.stringify({
    status: 'PASS',
    supplier_api: 'live_readonly',
    list_calls: 1,
    exact_detail_calls: 3,
    database_access: false,
    imported_into_catalog: 0,
    published: 0,
    offers: report,
  }));
}

if (require.main === module) {
  main().catch(error => {
    const text = String(error?.message || '');
    const safeReason = /^CJ_[A-Z0-9_]+$/.test(text)
      ? text : 'CJ_READONLY_PROVIDER_REQUEST_FAILED';
    console.error('CJ_READONLY_THREE_EXACT_OFFERS ' + JSON.stringify({
      status: 'BLOCKED', reason: safeReason, database_access: false,
    }));
    process.exitCode = 1;
  });
}

module.exports = { assertReadOnlyWorker, safeId, main };
