/**
 * @komerce-arch
 * @role          refinery-readonly-coverage
 * @domain        catalog
 * @layer         service
 * @criticality   medium
 * @inputs        canonical_products_and_sourcing_handoffs
 * @outputs       refinery_coverage_and_unprepared_candidate_projection
 * @db-read       products, sourcing_candidates
 * @db-write      none
 * @doctrine      refinery_prepares_catalog_registers_market_decides, no_implicit_publication
 */
'use strict';

const db = require('../db');
const catalogRegistry = require('./catalog-registry');
const ELIGIBLE_CONTENT_SOURCES = ['connector_raw', 'ai_enriched', 'manual'];
const MISSING_CONTENT_SOURCE = "(p.content_source IS NULL OR p.content_source NOT IN ('connector_raw', 'ai_enriched', 'manual'))";

/**
 * Diagnostic only: never use this projection to approve or mutate a product.
 * The approval authority remains services/catalog-approval.js.
 */
function explainUnprepared(row = {}) {
  const value = String(row.content_source || '').trim();
  return value
    ? { code: 'content_status_unrecognized', label: 'Statut de contenu à examiner', detail: `État enregistré : ${value}` }
    : { code: 'content_source_missing', label: 'Source du contenu à qualifier', detail: 'Aucune origine éditoriale reconnue pour ce brouillon' };
}

async function getRefineryCoverage(executor = db) {
  const { rows } = await executor.query(`
    SELECT
      COUNT(*) FILTER (
        WHERE p.lifecycle_status = 'candidate' AND p.is_active = FALSE
          AND p.content_source IN ('connector_raw', 'ai_enriched', 'manual')
      )::int AS in_approval_queue,
      COUNT(*) FILTER (
        WHERE p.lifecycle_status = 'candidate' AND p.is_active = FALSE
          AND ${MISSING_CONTENT_SOURCE}
      )::int AS unprepared_candidates,
      COUNT(*) FILTER (WHERE p.is_active = TRUE)::int AS active_products,
      COUNT(*) FILTER (WHERE p.lifecycle_status = 'rejected')::int AS rejected_products,
      COUNT(*) FILTER (
        WHERE p.is_active = TRUE
          AND EXISTS (
            SELECT 1 FROM sourcing_candidates c
             WHERE c.product_id = p.id AND c.state = 'imported_to_catalog'
          )
      )::int AS handoff_already_active
    FROM products p
  `);
  const row = rows[0] || {};
  return {
    in_approval_queue: Number(row.in_approval_queue) || 0,
    unprepared_candidates: Number(row.unprepared_candidates) || 0,
    handoff_already_active: Number(row.handoff_already_active) || 0,
    // Separate global indicators: never present these as Raffinerie work.
    active_products: Number(row.active_products) || 0,
    rejected_products: Number(row.rejected_products) || 0,
  };
}

async function listUnpreparedCandidates({ limit = 30, offset = 0 } = {}, executor = db) {
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 30, 1), 50);
  const safeOffset = Math.max(Number.parseInt(offset, 10) || 0, 0);
  const { rows } = await executor.query(`
    SELECT p.product_ref, p.name, p.content_source, p.created_at,
           sc.candidate_ref, sc.supplier_name
      FROM products p
      LEFT JOIN LATERAL (
        SELECT c.candidate_ref, c.supplier_name
          FROM sourcing_candidates c
         WHERE c.product_id = p.id AND c.state = 'imported_to_catalog'
         ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC
         LIMIT 1
      ) sc ON TRUE
     WHERE p.lifecycle_status = 'candidate'
       AND p.is_active = FALSE
       AND ${MISSING_CONTENT_SOURCE}
     ORDER BY p.created_at ASC, p.product_ref ASC
     LIMIT $1 OFFSET $2
  `, [safeLimit, safeOffset]);
  return rows.map(row => ({
    product_ref: row.product_ref,
    name: row.name || row.product_ref,
    candidate_ref: row.candidate_ref || null,
    supplier_name: row.supplier_name || null,
    reason: explainUnprepared(row),
  }));
}

async function buildRefineryWorklist(query = {}, executor = db) {
  const limit = Math.min(Math.max(Number.parseInt(query.refinery_limit, 10) || 30, 1), 50);
  const offset = Math.max(Number.parseInt(query.refinery_offset, 10) || 0, 0);
  const recheckOffset = Math.max(Number.parseInt(query.refinery_recheck_offset, 10) || 0, 0);
  const [coverage, candidates, recheck] = await Promise.all([
    getRefineryCoverage(executor),
    listUnpreparedCandidates({ limit, offset }, executor),
    catalogRegistry.listRegistry({
      refinery_recheck_only: true,
      limit,
      offset: recheckOffset,
    }, executor),
  ]);
  return {
    scope: 'refinery_readonly_diagnostic',
    coverage: { ...coverage, active_recheck: recheck.page.total },
    recheck: recheck.products,
    recheck_page: recheck.page,
    unprepared: candidates,
    unprepared_page: {
      total: coverage.unprepared_candidates,
      limit,
      offset,
      has_previous: offset > 0,
      has_next: offset + candidates.length < coverage.unprepared_candidates,
    },
  };
}

module.exports = {
  buildRefineryWorklist,
  _test: { explainUnprepared, getRefineryCoverage, listUnpreparedCandidates, ELIGIBLE_CONTENT_SOURCES },
};
