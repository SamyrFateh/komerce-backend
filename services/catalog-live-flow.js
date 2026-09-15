/**
 * @komerce-arch
 * @role          catalog-live-source-flow-projection
 * @domain        catalog
 * @layer         service
 * @criticality   medium
 * @inputs        sourcing_source_runtime, sourcing_candidates, catalog_products, market_visibility
 * @outputs       catalog_live_sources, refinery_pipeline, incoming_products, source_discovery
 * @depends       db.js, services/sourcing-source-autopilot.js, services/sourcing-import-dispatch.js
 * @used-by       services/catalog-workspace.js
 * @db-read       sourcing_candidates, products, product_market_exposure, product_market_price_drafts, markets
 * @db-write      none
 * @db-txn        none
 * @doctrine      catalog_observes_sourcing_without_stealing_mutation_authority, live_flow_uses_real_boutique_visibility_predicate
 * @impact-areas  catalog, sourcing, boutique, admin-dashboard
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const sourceAutopilot = require('./sourcing-source-autopilot');
const importDispatch = require('./sourcing-import-dispatch');

const QUALIFIED_STATES = Object.freeze(['scanned', 'test_ready', 'watchlist', 'imported_to_catalog']);
const NORMALIZED_STATES = Object.freeze(['normalized', ...QUALIFIED_STATES]);

function number(value) {
  return Number(value) || 0;
}

function boutiqueEffectiveSql(productAlias = 'p') {
  return `
    ${productAlias}.is_active = TRUE
    AND ${productAlias}.is_available = TRUE
    AND EXISTS (
      SELECT 1
        FROM product_market_exposure pme
        JOIN markets em ON em.id = pme.market_id AND em.is_active = TRUE
       WHERE pme.product_id = ${productAlias}.id
         AND pme.commercial_exposure = 'ENABLED'
    )
    AND EXISTS (
      SELECT 1
        FROM product_market_price_drafts pmpd
        JOIN markets pm ON pm.id = pmpd.market_id AND pm.is_active = TRUE
       WHERE pmpd.product_id = ${productAlias}.id
         AND pmpd.status = 'LOCAL_ACTIVE'
    )`;
}

function stageFromRow(row) {
  if (row.boutique_effective) return 'boutique';
  if (row.product_is_active) return 'catalog';
  if (row.product_ref) {
    if (row.content_source === 'ai_enriched' && !row.needs_review) return 'fr_ready';
    return 'curation';
  }
  if (QUALIFIED_STATES.includes(row.state)) return 'qualified';
  if (row.state === 'normalized') return 'normalized';
  return 'captured';
}

function nextStep(stage) {
  const steps = {
    captured: 'Normalisation',
    normalized: 'Qualification',
    qualified: 'Promotion catalogue',
    fr_ready: 'Curation',
    curation: 'Décision catalogue',
    catalog: 'Exposition + prix marché',
    boutique: 'Boutique',
  };
  return steps[stage] || 'Raffinerie';
}

async function queryPipelineTotals() {
  const { rows: [row] } = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE sc.state <> 'rejected')::int AS captured,
      COUNT(*) FILTER (WHERE sc.state = ANY($1::text[]))::int AS normalized,
      COUNT(*) FILTER (WHERE sc.state = ANY($2::text[]))::int AS qualified,
      COUNT(*) FILTER (
        WHERE p.id IS NOT NULL
          AND p.content_source = 'ai_enriched'
          AND p.needs_review = FALSE
      )::int AS fr_ready,
      COUNT(*) FILTER (
        WHERE p.id IS NOT NULL
          AND p.lifecycle_status = 'candidate'
          AND p.is_active = FALSE
      )::int AS curation,
      COUNT(*) FILTER (WHERE p.is_active = TRUE)::int AS catalog,
      COUNT(*) FILTER (WHERE ${boutiqueEffectiveSql('p')})::int AS boutique
      FROM sourcing_candidates sc
      LEFT JOIN products p ON p.id = sc.product_id
  `, [NORMALIZED_STATES, QUALIFIED_STATES]);
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, number(value)]));
}

async function queryPipelineBySupplier() {
  const { rows } = await db.query(`
    SELECT
      sc.supplier_name,
      COUNT(*) FILTER (WHERE sc.state <> 'rejected')::int AS captured,
      COUNT(*) FILTER (WHERE sc.state = ANY($1::text[]))::int AS normalized,
      COUNT(*) FILTER (WHERE sc.state = ANY($2::text[]))::int AS qualified,
      COUNT(*) FILTER (
        WHERE p.id IS NOT NULL
          AND p.content_source = 'ai_enriched'
          AND p.needs_review = FALSE
      )::int AS fr_ready,
      COUNT(*) FILTER (
        WHERE p.id IS NOT NULL
          AND p.lifecycle_status = 'candidate'
          AND p.is_active = FALSE
      )::int AS curation,
      COUNT(*) FILTER (WHERE p.is_active = TRUE)::int AS catalog,
      COUNT(*) FILTER (WHERE ${boutiqueEffectiveSql('p')})::int AS boutique
      FROM sourcing_candidates sc
      LEFT JOIN products p ON p.id = sc.product_id
     GROUP BY sc.supplier_name
     ORDER BY sc.supplier_name
  `, [NORMALIZED_STATES, QUALIFIED_STATES]);
  return new Map(rows.map(row => [String(row.supplier_name || '').toLowerCase(), {
    captured: number(row.captured),
    normalized: number(row.normalized),
    qualified: number(row.qualified),
    fr_ready: number(row.fr_ready),
    curation: number(row.curation),
    catalog: number(row.catalog),
    boutique: number(row.boutique),
  }]));
}

async function queryIncoming(limit = 12) {
  const safeLimit = Math.min(Math.max(Number(limit) || 12, 1), 50);
  const { rows } = await db.query(`
    SELECT
      sc.candidate_ref,
      sc.supplier_name,
      sc.supplier_product_id,
      sc.product_name,
      sc.image_url,
      sc.purchase_price,
      sc.purchase_price_kmf,
      sc.currency,
      sc.stock_available,
      sc.state,
      sc.updated_at,
      p.product_ref,
      p.content_source,
      p.needs_review,
      p.is_active AS product_is_active,
      (${boutiqueEffectiveSql('p')}) AS boutique_effective
      FROM sourcing_candidates sc
      LEFT JOIN products p ON p.id = sc.product_id
     WHERE sc.state <> 'rejected'
     ORDER BY sc.updated_at DESC
     LIMIT $1
  `, [safeLimit]);

  return rows.map(row => {
    const stage = stageFromRow(row);
    return {
      candidate_ref: row.candidate_ref,
      product_ref: row.product_ref || null,
      supplier_name: row.supplier_name,
      supplier_product_id: row.supplier_product_id,
      product_name: row.product_name,
      image_url: row.image_url || null,
      purchase_price: row.purchase_price == null ? null : Number(row.purchase_price),
      purchase_price_kmf: row.purchase_price_kmf == null ? null : Number(row.purchase_price_kmf),
      currency: row.currency || null,
      stock_available: row.stock_available == null ? null : Number(row.stock_available),
      state: row.state,
      stage,
      next_step: nextStep(stage),
      needs_review: Boolean(row.needs_review),
      updated_at: row.updated_at || null,
    };
  });
}

function sourceDiscoveryCatalog() {
  const connectors = importDispatch.connectorCatalog();
  return [
    ...(connectors.api_suppliers || []).map(source => ({
      key: source.supplier,
      label: source.label,
      kind: 'api',
      connector_ready: Boolean(source.active),
      automation_available: Boolean(source.automation_available),
      reason: source.reason || null,
    })),
    ...(connectors.sources || []).map(source => ({
      key: source.type,
      label: source.label,
      kind: source.type,
      connector_ready: Boolean(source.active),
      automation_available: false,
      reason: null,
    })),
  ];
}

async function buildProjection({ incomingLimit = 12 } = {}) {
  const [sources, totals, bySupplier, incoming] = await Promise.all([
    sourceAutopilot.listSources(),
    queryPipelineTotals(),
    queryPipelineBySupplier(),
    queryIncoming(incomingLimit),
  ]);

  const sourceRows = sources.map(source => ({
    ...source,
    pipeline: bySupplier.get(String(source.supplier_name || '').toLowerCase()) || {
      captured: 0,
      normalized: 0,
      qualified: 0,
      fr_ready: 0,
      curation: 0,
      catalog: 0,
      boutique: 0,
    },
  }));

  return {
    mode: 'live_catalog_flow',
    sources: sourceRows,
    pipeline: totals,
    incoming,
    source_catalog: sourceDiscoveryCatalog(),
    refresh_hint_seconds: 10,
    mutation_authority: 'sourcing',
    source_toggle_endpoint: '/api/admin/workspaces/sourcing/sources/{sourceRef}/{activate|deactivate}',
  };
}

module.exports = {
  buildProjection,
  _test: {
    boutiqueEffectiveSql,
    stageFromRow,
    nextStep,
    sourceDiscoveryCatalog,
    queryPipelineTotals,
    queryPipelineBySupplier,
    queryIncoming,
  },
};
