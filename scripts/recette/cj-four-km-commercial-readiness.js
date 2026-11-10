#!/usr/bin/env node
'use strict';
/** @komerce-arch
 * @role          cj-four-km-commercial-readiness
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        official staging DB, KIR-000014, exact four product refs
 * @outputs       read-only per-product editorial/media/SOI/cost/market-pricing blockers
 * @depends       scripts/recette/target-guard.js
 * @db-read       import_runtime_runs, sourcing_candidates, products, product_skus, catalog_media,
 *                product_market_exposure, product_market_price_drafts, markets
 * @db-write      none
 * @db-txn        BEGIN READ ONLY
 * @doctrine      exact_real_source_not_sellability_no_invented_cost_or_price
 * @impact-areas  staging, catalog, economics, sourcing
 */
const fs = require('node:fs');
const path = require('node:path');
const RUN = 'KIR-000014';
const EXPECTED = new Map([
  ['KSC-000256', { product:'KPR-000098', supplier:'4978336F-15C5-476B-BFE8-C907659B70BB' }],
  ['KSC-000257', { product:'KPR-000099', supplier:'1396999123722440704' }],
  ['KSC-000258', { product:'KPR-000100', supplier:'1410157074293329920' }],
  ['KSC-000259', { product:'KPR-000101', supplier:'BE74E804-F8CB-4D8A-B84A-DE98494DC9FD' }],
]);
const OUT = path.resolve('test-results/cj-four-km-commercial-readiness/report.json');

function expectedDatabasePin(url) {
  try { const u = new URL(url); return [u.hostname, u.port || '5432'].join(':') + u.pathname; }
  catch (_) { return null; }
}
function assertStaging(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.KOMERCE_ENV !== 'staging'
      || env.NODE_ENV !== 'test' || env.CJ_FOUR_COMMERCIAL_AUDIT_APPROVED !== '1'
      || env.EXPECTED_RAILWAY_ENVIRONMENT !== 'staging'
      || env.STAGING_BASE_URL !== 'https://komerce-backend-production.up.railway.app'
      || !env.DATABASE_URL || !env.KOMERCE_STAGING_RESET_DB_PIN
      || expectedDatabasePin(env.DATABASE_URL) !== env.KOMERCE_STAGING_RESET_DB_PIN)
    throw new Error('CJ_FOUR_COMMERCIAL_STAGING_GUARD_REQUIRED');
}
function safeCount(n) { return Number(n || 0); }
function assessProduct(row) {
  const expected = EXPECTED.get(row.candidate_ref);
  const p = row.product || {};
  const contract = row.normalized_source_contract || {};
  const skus = Array.isArray(row.skus) ? row.skus : [];
  const media = Array.isArray(row.media) ? row.media : [];
  const units = Array.isArray(contract.sellable_units) ? contract.sellable_units : [];
  const hard = [];
  const decisions = [];
  if (!expected || row.supplier_product_id !== expected.supplier || p.product_ref !== expected.product
      || row.state !== 'imported_to_catalog' || !row.product_id)
    hard.push('SOURCE_PRODUCT_IDENTITY_DRIFT');
  if (p.is_active !== false || p.is_available !== false
      || p.lifecycle_status !== 'candidate' || p.price_kmf != null
      || safeCount(row.exposure_count) !== 0)
    hard.push('UNEXPECTED_PREMATURE_ACTIVATION_OR_PRICE');
  if (!skus.length || skus.length !== units.length)
    hard.push('SUPPLIER_SKU_COUNT_MISMATCH');
  const withOrderIdentity = skus.filter(s => s.supplier_sku
    && (s.supplier_unit_ref || s.supplier_order_identity)).length;
  if (withOrderIdentity !== skus.length || skus.some(s => s.source !== 'SUPPLIER'))
    hard.push('SUPPLIER_ORDER_IDENTITY_UNPROVEN');
  const activeMedia = media.filter(m => m.is_active === true && /^https:\/\//i.test(m.url || ''));
  if (!activeMedia.length) decisions.push('CATALOGUE_MEDIA_REVIEW_REQUIRED');
  if (!p.name || !p.description || p.needs_review !== false || p.source_locale !== 'fr')
    decisions.push('FRENCH_EDITORIAL_REVIEW_REQUIRED');
  const scan = row.scan_result || {};
  const customsStatus = scan.customs_review?.status || null;
  if (customsStatus === 'REQUIRED') decisions.push('CUSTOMS_REVIEW_REQUIRED');
  else decisions.push('CUSTOMS_CLEARANCE_NOT_INDEPENDENTLY_VERIFIED');
  if (String(scan.sourcing_decision || '').toUpperCase() === 'WATCH')
    decisions.push('SOURCE_WATCH_NOT_CERTIFIED_FOR_SALE');
  if (!(safeCount(p.cost_kmf) > 0) || !(safeCount(p.weight_kg) > 0))
    decisions.push('PURCHASE_COST_OR_WEIGHT_INPUT_INCOMPLETE');
  if (!units.some(u => Number.isInteger(u.stock_available) && u.stock_available > 0))
    decisions.push('SUPPLIER_LIVE_STOCK_NOT_PROVEN');
  if (safeCount(row.price_drafts) === 0) decisions.push('KM_MARKET_PRICE_DECISION_MISSING');
  decisions.push('KM_N1_N2_LANDED_COST_AND_PRICING_GATE_NOT_CERTIFIED');
  return {
    candidate_ref: row.candidate_ref,
    product_ref: p.product_ref || null,
    supplier_product_id: row.supplier_product_id,
    title_current: String(p.name || '').slice(0,160),
    boutique_category: p.boutique_category_key || null,
    boutique_subcategory: p.boutique_subcategory_key || null,
    source_locale: p.source_locale || null,
    needs_editorial_review: p.needs_review !== false,
    description_present: Boolean(p.description),
    source_decision: scan.sourcing_decision || null,
    customs_review_status: customsStatus,
    source_cost_kmf: p.cost_kmf == null ? null : Number(p.cost_kmf),
    weight_kg: p.weight_kg == null ? null : Number(p.weight_kg),
    units_source: units.length,
    persisted_skus: skus.length,
    skus_with_supplier_order_identity: withOrderIdentity,
    positive_supplier_stock_units: units.filter(u=>Number.isInteger(u.stock_available) && u.stock_available > 0).length,
    canonical_media: media.length,
    canonical_active_https_media: activeMedia.length,
    market_price_drafts: safeCount(row.price_drafts),
    market_exposure: safeCount(row.exposure_count),
    hard_blockers: [...new Set(hard)],
    human_or_economic_decisions: [...new Set(decisions)],
    safe_to_sell: false,
  };
}
const QUERY = [
  'SELECT c.candidate_ref, c.supplier_product_id, c.state, c.product_id,',
  '       c.normalized_source_contract, c.scan_result, to_jsonb(p) AS product,',
  '       (SELECT coalesce(jsonb_agg(jsonb_build_object(',
  "          'supplier_sku',s.supplier_sku, 'supplier_unit_ref',s.supplier_unit_ref,",
  "          'supplier_order_identity',s.supplier_order_identity, 'source',s.source)), '[]'::jsonb)",
  '          FROM product_skus s WHERE s.product_id=p.id) AS skus,',
  '       (SELECT coalesce(jsonb_agg(jsonb_build_object(',
  "          'url',m.url,'is_active',m.is_active)), '[]'::jsonb)",
  '          FROM catalog_media m WHERE m.product_id=p.id) AS media,',
  '       (SELECT count(*)::int FROM product_market_exposure x',
  '         WHERE x.product_id=p.id) AS exposure_count,',
  '       (SELECT count(*)::int FROM product_market_price_drafts d',
  '         JOIN markets k ON k.id=d.market_id',
  "         WHERE d.product_id=p.id AND k.code='KM') AS price_drafts",
  '  FROM import_runtime_runs r JOIN sourcing_candidates c ON c.import_id=r.import_id',
  '  LEFT JOIN products p ON p.id=c.product_id',
  ' WHERE r.run_ref=$1 ORDER BY c.candidate_ref',
].join('\n');
// La cohorte est définie par le RUN fournisseur exact KIR-000014, jamais par le
// total Catalogue : d'autres produits de recette peuvent coexister sur staging.
function cohortIdentitiesMatch(rows) {
  const refs = new Set(rows.map(row => row.candidate_ref));
  return rows.length === EXPECTED.size && refs.size === EXPECTED.size
    && [...refs].every(ref => EXPECTED.has(ref));
}
async function audit() {
  assertStaging(process.env);
  // All connections, including the guard, are read-only at PostgreSQL server level.
  process.env.PGOPTIONS = [process.env.PGOPTIONS, '-c default_transaction_read_only=on'].filter(Boolean).join(' ');
  const db = require('../../db');
  const { confirmTarget } = require('./target-guard');
  const report = { mode:'READ_ONLY', run_ref:RUN, verdict:'UNVERIFIED', no_writes:true };
  let client, began=false;
  try {
    const target = await confirmTarget({ db });
    if (!target?.confirmed) throw new Error('STAGING_TARGET_NOT_CONFIRMED');
    report.target_fingerprint = target.fingerprint;
    client = await db.getClient();
    await client.query('BEGIN READ ONLY'); began=true;
    await client.query("SET LOCAL statement_timeout='15000ms'");
    const { rows } = await client.query(QUERY, [RUN]);
    const {rows:[totals]} = await client.query('SELECT count(*)::int AS products FROM products');
    const {rows:[km]} = await client.query("SELECT code,is_active,currency FROM markets WHERE code='KM'");
    report.market = km || null;
    report.total_products = totals.products;
    report.products = rows.map(assessProduct);
    report.hard_blockers = [];
    report.cohort_products = rows.length;
    report.other_staging_products = Math.max(0, report.total_products - rows.length);
    if (!cohortIdentitiesMatch(rows))
      report.hard_blockers.push('EXACT_FOUR_PRODUCT_COHORT_NOT_MATCHED');
    if (!km || km.is_active !== true || km.currency !== 'KMF')
      report.hard_blockers.push('KM_MARKET_NOT_READY');
    for (const p of report.products) for(const b of p.hard_blockers)
      report.hard_blockers.push(p.product_ref + ':' + b);
    report.verdict = report.hard_blockers.length
      ? 'SOURCE_OR_CATALOGUE_INTEGRITY_BLOCKED'
      : 'FOUR_REAL_DRAFTS_VERIFIED_COMMERCIAL_DECISIONS_PENDING';
    await client.query('ROLLBACK'); began=false;
    return report;
  } catch (err) {
    if (began) await client.query('ROLLBACK').catch(()=>{});
    report.hard_blockers = [String(err.code || err.message).slice(0,160)];
    report.verdict = 'AUDIT_FAILED';
    return report;
  } finally {
    if (client) client.release();
    if (db.pool?.end) await db.pool.end();
  }
}
async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const report = await audit();
  fs.writeFileSync(OUT,JSON.stringify(report,null,2)+'\n');
  console.log('[CJ_FOUR_KM_COMMERCIAL] '+JSON.stringify(report));
  if (report.verdict !== 'FOUR_REAL_DRAFTS_VERIFIED_COMMERCIAL_DECISIONS_PENDING')
    process.exitCode = 2;
}
if (require.main === module) main().catch(e=>{console.error(String(e.code||e.message));process.exitCode=1;});
module.exports = { assertStaging, expectedDatabasePin, assessProduct, cohortIdentitiesMatch, RUN, EXPECTED, QUERY };
