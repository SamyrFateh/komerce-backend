/**
 * @komerce-arch
 * @role          sourcing-product-read-comparison
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        canonical_product_projection, sourcing_candidate_linkage, historical_catalog_product
 * @outputs       parallel_product_read_comparison
 * @depends       db.js, services/sourcing-canonical-product-projection.js
 * @used-by       scripts/sourcing-product-read-comparison-staging.js
 * @db-read       sourcing_canonical_entities, sourcing_resolution_bindings, sourcing_observations, sourcing_captures, sourcing_candidates, products
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SOURCE_PRODUCT_READ_COMPARISON.md
 * @impact-areas  sourcing, catalog
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const canonicalProjection = require('./sourcing-canonical-product-projection');

const COMPARISON_VERSION = 'canonical-product-read-comparison-v1';

function stableValue(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function compareProjectedField(projectedField, historicalValue) {
  if (!projectedField || projectedField.status === 'ABSENT') {
    return { status: 'NO_CANONICAL_VALUE', historical_value: historicalValue ?? null };
  }

  if (historicalValue === null || historicalValue === undefined || historicalValue === '') {
    return { status: 'HISTORICAL_VALUE_MISSING', historical_value: historicalValue ?? null };
  }

  if (projectedField.status === 'CONSENSUS') {
    return {
      status: stableValue(projectedField.value) === stableValue(historicalValue) ? 'PARITY' : 'MISMATCH',
      canonical_value: projectedField.value,
      historical_value: historicalValue,
    };
  }

  if (projectedField.status === 'CONFLICT_PRESERVED') {
    const candidates = projectedField.candidates || [];
    const found = candidates.some((candidate) => stableValue(candidate.value) === stableValue(historicalValue));
    return {
      status: found ? 'SOURCE_VARIANT_ACCEPTED' : 'MISMATCH_OUTSIDE_CONFLICT_SET',
      canonical_value: null,
      historical_value: historicalValue,
      candidate_values: candidates.map((candidate) => candidate.value),
    };
  }

  return { status: 'UNSUPPORTED_PROJECTION_STATUS', historical_value: historicalValue ?? null };
}

function buildCatalogComparison(projectedProduct, historicalProduct) {
  const fields = projectedProduct?.fields || {};
  const compared = {
    product_name: compareProjectedField(fields.product_name, historicalProduct.name_source || historicalProduct.name),
    description: compareProjectedField(fields.description, historicalProduct.description_source),
    source_locale: compareProjectedField(fields.source_locale, historicalProduct.source_locale),
    weight_kg: compareProjectedField(fields.weight_kg, historicalProduct.weight_kg == null ? null : Number(historicalProduct.weight_kg)),
  };
  const mismatchStatuses = new Set(['MISMATCH', 'MISMATCH_OUTSIDE_CONFLICT_SET', 'UNSUPPORTED_PROJECTION_STATUS']);
  const mismatches = Object.entries(compared)
    .filter(([, verdict]) => mismatchStatuses.has(verdict.status))
    .map(([field]) => field);

  return {
    product_id: historicalProduct.product_id,
    lifecycle_status: historicalProduct.lifecycle_status,
    is_active: historicalProduct.is_active,
    fields: compared,
    mismatches,
    status: mismatches.length ? 'MISMATCH' : 'COMPATIBLE',
  };
}

function unpromotedCandidatesFromRows(rows) {
  const unique = new Map();
  for (const row of rows || []) {
    if (!row.candidate_id || row.product_id || unique.has(row.candidate_id)) continue;
    unique.set(row.candidate_id, {
      candidate_id: row.candidate_id,
      candidate_state: row.candidate_state,
      canonical_product_id: row.canonical_entity_id,
      source_id: row.source_id,
      source_ref: row.source_ref,
    });
  }
  return [...unique.values()];
}

async function collectProductReadComparison(query = db.query.bind(db)) {
  const projectionReport = await canonicalProjection.collectCanonicalProductProjections(query);
  const linkageResult = await query(`
    SELECT ce.canonical_entity_id,
           c.source_id,
           o.observation_id,
           o.source_ref,
           sc.id AS candidate_id,
           sc.state AS candidate_state,
           sc.product_id,
           p.name,
           p.name_source,
           p.description_source,
           p.source_locale,
           p.weight_kg,
           p.lifecycle_status,
           p.is_active
      FROM sourcing_canonical_entities ce
      JOIN sourcing_resolution_bindings rb
        ON rb.canonical_entity_id = ce.canonical_entity_id
       AND rb.ended_at IS NULL
      JOIN sourcing_observations o
        ON o.observation_id = rb.observation_id
      JOIN sourcing_captures c
        ON c.capture_id = o.capture_id
      LEFT JOIN sourcing_candidates sc
        ON sc.import_id = NULLIF(c.stats->>'import_id', '')::uuid
       AND sc.supplier_product_id = o.source_ref
      LEFT JOIN products p
        ON p.id = sc.product_id
     WHERE ce.grain::text = 'product'
       AND ce.status = 'active'
       AND o.grain::text = 'product'
     ORDER BY ce.canonical_entity_id, c.source_id, o.observation_id
  `);

  const projectionById = new Map((projectionReport.products || []).map((product) => [product.canonical_product_id, product]));
  const rows = linkageResult.rows || [];
  const candidateLinks = rows.filter((row) => row.candidate_id);
  const catalogLinks = rows.filter((row) => row.product_id);
  const missingCandidateLinks = rows.filter((row) => !row.candidate_id);
  const unpromotedCandidateLinks = unpromotedCandidatesFromRows(rows);
  const historicalByCanonical = new Map();

  for (const row of catalogLinks) {
    if (!historicalByCanonical.has(row.canonical_entity_id)) historicalByCanonical.set(row.canonical_entity_id, new Map());
    historicalByCanonical.get(row.canonical_entity_id).set(row.product_id, row);
  }

  const comparisons = [];
  for (const [canonicalId, productsById] of historicalByCanonical.entries()) {
    const projected = projectionById.get(canonicalId);
    if (!projected) continue;
    for (const historical of productsById.values()) {
      comparisons.push({
        canonical_product_id: canonicalId,
        source_count: projected.source_count,
        projection_status: projected.projection_status,
        ...buildCatalogComparison(projected, historical),
      });
    }
  }

  const mismatchCount = comparisons.filter((item) => item.status === 'MISMATCH').length;
  const hardFailures = [];
  if (missingCandidateLinks.length) hardFailures.push('canonical_observation_without_historical_candidate_link');
  if (mismatchCount) hardFailures.push('historical_catalog_product_mismatch');

  let status = 'PASS';
  const blockers = [];
  if (!catalogLinks.length) {
    status = 'BLOCKED';
    blockers.push('no_historical_catalog_product_link');
  } else if (hardFailures.length) {
    status = 'FAIL';
  }

  return {
    comparison_version: COMPARISON_VERSION,
    generated_at: new Date().toISOString(),
    authority: 'shadow_read_only',
    historical_catalog_authority_unchanged: true,
    summary: {
      canonical_product_observations: rows.length,
      candidate_links: candidateLinks.length,
      candidate_link_coverage: rows.length ? candidateLinks.length / rows.length : 0,
      catalog_product_links: catalogLinks.length,
      unpromoted_candidates: unpromotedCandidateLinks.length,
      distinct_catalog_products: new Set(catalogLinks.map((row) => row.product_id)).size,
      comparisons: comparisons.length,
      mismatches: mismatchCount,
    },
    missing_candidate_links: missingCandidateLinks.map((row) => ({
      canonical_product_id: row.canonical_entity_id,
      source_id: row.source_id,
      source_ref: row.source_ref,
    })),
    unpromoted_candidate_links: unpromotedCandidateLinks,
    comparisons,
    verdict: {
      status,
      blockers,
      hard_failures: hardFailures,
      ready_for_catalog_product_read_cutover_trial: status === 'PASS' && comparisons.length > 0,
    },
  };
}

module.exports = {
  COMPARISON_VERSION,
  collectProductReadComparison,
  compareProjectedField,
  buildCatalogComparison,
  unpromotedCandidatesFromRows,
  _stableValue: stableValue,
};
