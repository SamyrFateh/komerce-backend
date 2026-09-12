#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          aliexpress-refinery-live-audit
 * @domain        catalog
 * @layer         tooling
 * @criticality   medium
 * @inputs        DATABASE_URL, KOMERCE_ENV=staging
 * @outputs       read-only AliExpress refinery decision diagnostics
 * @depends       db.js
 * @used-by       bounded GitHub staging audit workflow
 * @db-read       sourcing_candidates
 * @db-write      none
 * @db-txn        none
 * @doctrine      observe_before_behavior_change, refinery_is_filter_not_bypass
 * @impact-areas  sourcing, catalog, staging
 * @version       2026-09-v2
 */
'use strict';

const db = require('../db');

const SUPPLIER = 'AliExpress';
const EXPECTED_CLEAN = 500;

function runtimeEnvironment(env = process.env) {
  return String(env.KOMERCE_ENV || '').trim().toLowerCase();
}

function assertRuntime(env = process.env) {
  const runtime = runtimeEnvironment(env);
  if (runtime !== 'staging') throw new Error(`REFUS: KOMERCE_ENV=staging requis (reçu: ${runtime || '<vide>'})`);
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
}

function cleanStockSql(alias = 'sc') {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`Alias SQL invalide: ${alias}`);
  return `(
    ${alias}.normalized_source_contract ? 'stock_available'
    AND (${alias}.normalized_source_contract->>'stock_available') ~ '^[0-9]+([.][0-9]+)?$'
    AND (${alias}.normalized_source_contract->>'stock_available')::numeric > 0
  )`;
}

function bump(map, key) {
  const normalized = String(key || '<missing>');
  map[normalized] = (map[normalized] || 0) + 1;
}

function stats(values) {
  const nums = values.map(Number).filter(Number.isFinite).filter(v => v > 0);
  if (!nums.length) return { count: 0, min: null, max: null };
  return { count: nums.length, min: Math.min(...nums), max: Math.max(...nums) };
}

function priceAuthority(scan = {}) {
  return scan.recommended_price_authority || scan.price_authority || null;
}

function summarize(rows) {
  const decisions = {};
  const health = {};
  const reasons = {};
  const authorities = {};
  const categories = {};
  const supplierCategories = {};
  const discoverySegments = {};
  const discoveryCategories = {};

  for (const row of rows) {
    bump(decisions, row.scan_result?.sourcing_decision);
    bump(health, row.scan_result?.health_status);
    bump(reasons, row.scan_result?.reason);
    bump(authorities, priceAuthority(row.scan_result));
    bump(categories, row.komerce_category);
    bump(supplierCategories, row.supplier_category);
    bump(discoverySegments, row.raw_payload?.discovery?.segment_id);
    bump(discoveryCategories, row.raw_payload?.discovery?.target_category);
  }

  return {
    clean_total: rows.length,
    decisions,
    health_status: health,
    reasons,
    price_authority: authorities,
    purchase_price_kmf: stats(rows.map(row => row.purchase_price_kmf)),
    variable_cost_complete_kmf: stats(rows.map(row => row.scan_result?.variable_cost_complete_kmf)),
    flow_variable_cost_kmf: stats(rows.map(row => row.scan_result?.flow_variable_cost_kmf)),
    business_variable_cost_kmf: stats(rows.map(row => row.scan_result?.business_variable_cost_kmf)),
    variable_cost_outside_purchase_kmf: stats(rows.map(row => row.scan_result?.variable_cost_outside_purchase_kmf)),
    test_price_kmf: stats(rows.map(row => row.scan_result?.test_price_kmf)),
    minimum_safe_price_kmf: stats(rows.map(row => row.scan_result?.minimum_safe_price_kmf)),
    categories,
    discovery_categories: discoveryCategories,
    discovery_segments: discoverySegments,
    supplier_category_distinct: Object.keys(supplierCategories).length,
  };
}

async function loadRows(queryable = db) {
  const { rows } = await queryable.query(
    `SELECT sc.supplier_product_id,
            sc.product_name,
            sc.supplier_category,
            sc.komerce_category,
            sc.purchase_price,
            sc.currency,
            sc.purchase_price_kmf,
            sc.estimated_weight_kg,
            sc.estimated_volume_m3,
            sc.data_sources,
            sc.scan_result,
            sc.raw_payload,
            sc.normalized_source_contract
       FROM sourcing_candidates sc
      WHERE sc.supplier_name = $1
        AND sc.supplier_product_id IS NOT NULL
        AND sc.state IN ('scanned', 'imported_to_catalog')
        AND COALESCE(sc.product_name, '') <> ''
        AND sc.image_url ~ '^https://'
        AND sc.purchase_price IS NOT NULL
        AND sc.purchase_price > 0
        AND ${cleanStockSql('sc')}
      ORDER BY sc.created_at, sc.id`,
    [SUPPLIER]
  );
  return rows;
}

function compactBreakdown(scan = {}) {
  const b = scan.cost_breakdown || {};
  const landed = b.landed_relay || {};
  const business = b.business || {};
  return {
    landed_relay_cost_kmf: scan.landed_relay_cost_kmf ?? b.landed_relay_cost_kmf ?? null,
    business_variable_cost_kmf: scan.business_variable_cost_kmf ?? null,
    product_cost: landed.product_cost ?? null,
    sourcing: landed.sourcing ?? null,
    hub: landed.hub ?? null,
    packaging: landed.packaging ?? null,
    freight: landed.freight ?? null,
    customs: landed.customs ?? null,
    port_transitaire: landed.port_transitaire ?? null,
    distribution: landed.distribution ?? null,
    local_distribution: landed.local_distribution ?? null,
    relay: landed.relay ?? null,
    payment: business.payment ?? null,
    risk_provision: business.risk_provision ?? null,
    fixed_overhead_reference: business.fixed_overhead ?? null,
  };
}

async function main() {
  assertRuntime();
  const rows = await loadRows();
  if (rows.length !== EXPECTED_CLEAN) {
    throw new Error(`REFUS: pool AliExpress clean attendu ${EXPECTED_CLEAN}, trouvé ${rows.length}`);
  }

  const summary = summarize(rows);
  const sample = rows.slice(0, 12).map(row => ({
    supplier_product_id: row.supplier_product_id,
    supplier_category: row.supplier_category,
    category: row.komerce_category,
    discovery: row.raw_payload?.discovery || null,
    data_sources: row.data_sources || null,
    purchase_price: row.purchase_price,
    currency: row.currency,
    purchase_price_kmf: row.purchase_price_kmf,
    weight_kg: row.estimated_weight_kg,
    volume_m3: row.estimated_volume_m3,
    sourcing_decision: row.scan_result?.sourcing_decision || null,
    health_status: row.scan_result?.health_status || null,
    reason: row.scan_result?.reason || null,
    market_confidence: row.scan_result?.market_confidence || null,
    variable_cost_complete_kmf: row.scan_result?.variable_cost_complete_kmf ?? null,
    variable_cost_outside_purchase_kmf: row.scan_result?.variable_cost_outside_purchase_kmf ?? null,
    minimum_safe_price_kmf: row.scan_result?.minimum_safe_price_kmf ?? null,
    test_price_kmf: row.scan_result?.test_price_kmf ?? null,
    recommended_price_authority: priceAuthority(row.scan_result),
    cost_breakdown: compactBreakdown(row.scan_result),
  }));

  console.log(`[aliexpress-refinery-audit] ${JSON.stringify({ runtime: runtimeEnvironment(), summary, sample }, null, 2)}`);
  return { summary, sample };
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(`[aliexpress-refinery-audit] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  SUPPLIER,
  EXPECTED_CLEAN,
  runtimeEnvironment,
  assertRuntime,
  cleanStockSql,
  stats,
  priceAuthority,
  summarize,
  compactBreakdown,
  loadRows,
  main,
};