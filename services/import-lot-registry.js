/**
 * @komerce-arch
 * @role          import-lot-registry-projection
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   high
 * @inputs        recent_import_runs, sourcing_candidates, catalog_products, active_markets, market_exposure, local_price_decisions
 * @outputs       canonical_import_lot_registry, decision_counts, derived_business_closure
 * @depends       db.js, services/catalog-run-progress.js
 * @used-by       routes/admin-sourcing-workspace.js
 * @db-read       import_runtime_runs, sourcing_candidates, products, catalog_media, markets, product_market_exposure, product_market_price_drafts
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_shows_decisions_not_pipeline_noise, closure_requires_terminal_decision_per_promoted_product, approved_for_sale_requires_exposure_and_local_active_price, browser_never_recomputes_business_truth
 * @impact-areas  admin-dashboard, sourcing, catalog, market-delegation, pricing
 * @version       2026-09
 */

'use strict';

const db = require('../db');
const { productProgress } = require('./catalog-run-progress');

const BUSINESS_STATUS = Object.freeze({
  RUNNING: 'RUNNING',
  ACTION_REQUIRED: 'ACTION_REQUIRED',
  BLOCKED: 'BLOCKED',
  CLOSED: 'CLOSED',
  NO_RESULT: 'NO_RESULT',
  ARCHIVED: 'ARCHIVED',
  UNKNOWN: 'UNKNOWN',
});

function positiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function iso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function sourceExceptionCount(run) {
  const intake = run?.intake || {};
  return positiveInt(intake.quarantined) + positiveInt(intake.certification_blocked);
}

function classifyProduct(row, marketRows, activeMarketCount) {
  if (!row?.product_id || !row?.product_ref) {
    return { state: 'EXCEPTION', action: 'EXCEPTION', reason: 'Produit catalogue introuvable' };
  }

  if (String(row.lifecycle_status || '').toLowerCase() === 'rejected') {
    return { state: 'NOT_RETAINED', action: null, reason: 'Écarté du Catalogue' };
  }

  const decisions = marketRows || [];
  const approved = decisions.some(item => item.exposure_enabled && item.price_active);
  if (approved) {
    return { state: 'APPROVED_FOR_SALE', action: null, reason: null };
  }

  const explicitlyHiddenEverywhere = activeMarketCount > 0
    && decisions.length === activeMarketCount
    && decisions.every(item => item.exposure_disabled === true);
  if (explicitlyHiddenEverywhere) {
    return { state: 'NOT_RETAINED', action: null, reason: 'Non retenu sur les marchés actifs' };
  }

  const progress = productProgress(row);
  if (progress.stage === 'preparing') {
    return { state: 'PENDING', action: 'CATALOGUE', reason: progress.reason };
  }
  if (progress.stage === 'ready' || progress.stage === 'published') {
    return { state: 'PENDING', action: 'COMMERCIAL', reason: progress.stage === 'ready'
      ? 'Décision commerciale attendue'
      : 'Prix / exposition marché à décider' };
  }
  return { state: 'EXCEPTION', action: 'EXCEPTION', reason: progress.reason || 'État Catalogue à examiner' };
}

function buildLot(run, candidates, marketDecisionRows, activeMarketCount) {
  const promotedMap = new Map();
  for (const row of candidates) {
    if (row.state !== 'imported_to_catalog' || !row.product_ref) continue;
    if (!promotedMap.has(String(row.product_ref))) promotedMap.set(String(row.product_ref), row);
  }
  const promoted = [...promotedMap.values()];
  const marketByProduct = new Map();
  for (const row of marketDecisionRows) {
    const key = String(row.product_id);
    if (!marketByProduct.has(key)) marketByProduct.set(key, []);
    marketByProduct.get(key).push(row);
  }

  const products = promoted.map(row => ({
    product_ref: row.product_ref,
    name: row.product_name || row.name || row.product_ref,
    ...classifyProduct(row, marketByProduct.get(String(row.product_id)) || [], activeMarketCount),
  }));

  const approved = products.filter(item => item.state === 'APPROVED_FOR_SALE').length;
  const notRetained = products.filter(item => item.state === 'NOT_RETAINED').length;
  const catalogue = products.filter(item => item.action === 'CATALOGUE').length;
  const commercial = products.filter(item => item.action === 'COMMERCIAL').length;
  const productExceptions = products.filter(item => item.action === 'EXCEPTION').length;
  const sourceExceptions = sourceExceptionCount(run);
  const exceptions = sourceExceptions + productExceptions;
  const terminal = approved + notRetained;
  const importComplete = run.status === 'COMPLETED';
  const closureEligible = importComplete
    && exceptions === 0
    && terminal === promoted.length;

  const hasBusinessFootprint = positiveInt(run.source_total) > 0
    || candidates.length > 0
    || promoted.length > 0
    || exceptions > 0;

  const emptyPass = run.status === 'FAILED'
    && !hasBusinessFootprint
    && ['no_valid_product', 'supplier_source_empty', 'all_supplier_products_invalid'].includes(String(run.failure_reason || ''));

  const connectorFailure = run.status === 'FAILED'
    && String(run.failure_reason || '').startsWith('connector_failed:');

  let businessStatus = BUSINESS_STATUS.ACTION_REQUIRED;
  if (emptyPass) businessStatus = BUSINESS_STATUS.NO_RESULT;
  else if (connectorFailure) businessStatus = BUSINESS_STATUS.BLOCKED;
  else if (run.status === 'FAILED' && !hasBusinessFootprint) businessStatus = BUSINESS_STATUS.ARCHIVED;
  else if (run.status === 'FAILED') businessStatus = BUSINESS_STATUS.BLOCKED;
  else if (run.status === 'RUNNING') businessStatus = BUSINESS_STATUS.RUNNING;
  else if (closureEligible) businessStatus = BUSINESS_STATUS.CLOSED;
  else if (!run.status) businessStatus = BUSINESS_STATUS.UNKNOWN;

  return {
    run_ref: run.run_ref,
    provider: run.provider,
    mode: run.mode,
    technical_status: run.status,
    failure_reason: run.failure_reason || null,
    business_status: businessStatus,
    source_total: positiveInt(run.source_total),
    promoted_products: promoted.length,
    started_at: iso(run.started_at),
    finished_at: iso(run.finished_at),
    updated_at: iso(run.updated_at),
    decisions: {
      catalogue,
      commercial,
      exceptions,
      approved_for_sale: approved,
      not_retained: notRetained,
    },
    closure: {
      eligible: closureEligible,
      decided_products: terminal,
      total_products: promoted.length,
      remaining_products: Math.max(0, promoted.length - terminal),
    },
    products,
  };
}

async function readLots({ limit = 12, runRef = null } = {}, executor = db) {
  const safeLimit = Math.min(Math.max(Number(limit) || 12, 1), 30);
  const requestedRun = runRef == null ? null : String(runRef);
  const { rows: runs } = await executor.query(
    `SELECT id::text AS id, run_ref, provider, mode, status, source_total, intake, failure_reason,
            started_at, finished_at, updated_at
       FROM import_runtime_runs
      WHERE ($2::text IS NULL OR run_ref = $2)
      ORDER BY started_at DESC
      LIMIT $1`,
    [safeLimit, requestedRun]
  );
  if (!runs.length) return [];

  const runIds = runs.map(row => row.id);
  const { rows: candidates } = await executor.query(
    `SELECT r.id::text AS run_id,
            sc.state,
            sc.product_name,
            p.id::text AS product_id,
            p.product_ref,
            p.name,
            p.description,
            p.category,
            p.lifecycle_status,
            p.is_active,
            p.needs_review,
            p.content_source,
            p.price_kmf,
            p.cost_kmf,
            (SELECT COUNT(*)::int
               FROM catalog_media cm
              WHERE cm.product_id = p.id
                AND cm.is_active = TRUE) AS active_media
       FROM import_runtime_runs r
       JOIN sourcing_candidates sc ON sc.import_id = r.import_id
       LEFT JOIN products p ON p.id = sc.product_id
      WHERE r.id = ANY($1::uuid[])`,
    [runIds]
  );

  const productIds = [...new Set(candidates.map(row => row.product_id).filter(Boolean))];
  const { rows: [{ count: marketCountRaw }] } = await executor.query(
    'SELECT COUNT(*)::int AS count FROM markets WHERE is_active = TRUE'
  );
  const activeMarketCount = positiveInt(marketCountRaw);

  let marketDecisionRows = [];
  if (productIds.length && activeMarketCount > 0) {
    const result = await executor.query(
      `SELECT p.id::text AS product_id,
              m.id::text AS market_id,
              BOOL_OR(pme.commercial_exposure = 'ENABLED') AS exposure_enabled,
              BOOL_OR(pme.commercial_exposure = 'DISABLED') AS exposure_disabled,
              BOOL_OR(pp.status = 'LOCAL_ACTIVE') AS price_active
         FROM products p
         CROSS JOIN markets m
         LEFT JOIN product_market_exposure pme
           ON pme.product_id = p.id
          AND pme.market_id = m.id
         LEFT JOIN product_market_price_drafts pp
           ON pp.product_id = p.id
          AND pp.market_id = m.id
        WHERE p.id = ANY($1::uuid[])
          AND m.is_active = TRUE
        GROUP BY p.id, m.id`,
      [productIds]
    );
    marketDecisionRows = result.rows;
  }

  const candidatesByRun = new Map();
  for (const row of candidates) {
    if (!candidatesByRun.has(row.run_id)) candidatesByRun.set(row.run_id, []);
    candidatesByRun.get(row.run_id).push(row);
  }
  const decisionsByProduct = new Map();
  for (const row of marketDecisionRows) {
    if (!decisionsByProduct.has(String(row.product_id))) decisionsByProduct.set(String(row.product_id), []);
    decisionsByProduct.get(String(row.product_id)).push(row);
  }

  return runs.map(run => {
    const runCandidates = candidatesByRun.get(run.id) || [];
    const relevantDecisionRows = [];
    for (const candidate of runCandidates) {
      if (!candidate.product_id) continue;
      relevantDecisionRows.push(...(decisionsByProduct.get(String(candidate.product_id)) || []));
    }
    return buildLot(run, runCandidates, relevantDecisionRows, activeMarketCount);
  });
}

async function listLots(options = {}, executor = db) {
  return readLots(options, executor);
}

async function getLot(runRef, executor = db) {
  const lots = await readLots({ limit: 1, runRef }, executor);
  return lots[0] || null;
}

module.exports = {
  BUSINESS_STATUS,
  sourceExceptionCount,
  classifyProduct,
  buildLot,
  listLots,
  getLot,
};
