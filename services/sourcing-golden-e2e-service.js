/**
 * @komerce-arch
 * @role          sourcing-golden-e2e-read-model
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        persisted multi-source lineage and canonical Unit resolutions
 * @outputs       deterministic Golden E2E integrity report
 * @depends       db.js, services/sourcing-canonical-product-projection.js, services/sourcing-canonical-unit-product-sku-resolution.js
 * @used-by       scripts/sourcing-golden-e2e-staging.js, tests/unit/sourcing-golden-e2e.test.js
 * @db-read       sourcing_sources, sourcing_captures, sourcing_observations, sourcing_resolution_bindings, sourcing_canonical_entities, sourcing_canonical_entity_refs, sourcing_candidates, products, product_skus
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SOURCING_GOLDEN_E2E.md
 * @impact-areas  sourcing, catalog, purchasing, supplier-integration
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const productProjection = require('./sourcing-canonical-product-projection');
const unitResolver = require('./sourcing-canonical-unit-product-sku-resolution');

const REPORT_VERSION = 'golden-sourcing-e2e-multisource-v1';
const REQUIRED_SOURCES = Object.freeze(['manual', 'cj', 'aliexpress']);
const ECONOMIC_PRODUCT_FIELDS = new Set([
  'purchase_price', 'currency', 'stock_available', 'min_order_qty',
  'supplier_delay_days', 'freight', 'freight_facts',
  'sellable_units', 'supplier_order_identity',
]);

const rowsOf = (result) => Array.isArray(result?.rows) ? result.rows : [];
const unique = (values) => [...new Set(values.filter((value) => value != null).map(String))].sort();

function sourceKind(row) {
  const adapter = String(row?.adapter_type || '').trim().toLowerCase();
  if (adapter && adapter !== 'api') return adapter;
  const sourceId = String(row?.source_id || '').trim().toLowerCase();
  if (sourceId) {
    const parts = sourceId.split(':').filter(Boolean);
    return parts[0] === 'api' ? (parts[1] || parts[0]) : parts[0];
  }
  return String(row?.supplier_name || '').trim().toLowerCase();
}

function section(failures, metrics) {
  return { status: failures.length ? 'FAIL' : 'PASS', ...metrics, failures };
}

function buildGoldenE2EReport(snapshot = {}) {
  const sources = snapshot.sources || [];
  const observations = snapshot.observations || [];
  const catalogRows = snapshot.catalog_rows || [];
  const refs = snapshot.refs || [];
  const products = snapshot.products || [];
  const resolutions = snapshot.resolutions || [];

  const hardFailures = [];
  const integrityFailures = [];
  const resolutionFailures = [];
  const catalogFailures = [];
  const unitFailures = [];
  const commandabilityFailures = [];
  const fail = (bucket, code) => {
    if (!bucket.includes(code)) bucket.push(code);
    if (!hardFailures.includes(code)) hardFailures.push(code);
  };

  const observedKinds = unique(sources.map(sourceKind));
  for (const required of REQUIRED_SOURCES) {
    if (!observedKinds.includes(required)) fail(integrityFailures, `required_source_missing:${required}`);
  }

  const provenanceLost = observations.filter((row) =>
    !row.source_id || !row.capture_id || !row.observation_id || !row.observed_at
  );
  if (provenanceLost.length) fail(integrityFailures, 'provenance_lost');

  const bindingByObservation = new Map();
  for (const row of observations) {
    if (!row.canonical_entity_id || row.entity_status !== 'active') continue;
    const ids = bindingByObservation.get(row.observation_id) || new Set();
    ids.add(String(row.canonical_entity_id));
    bindingByObservation.set(row.observation_id, ids);
  }
  if ([...bindingByObservation.values()].some((ids) => ids.size > 1)) {
    fail(resolutionFailures, 'product_linked_to_multiple_active_canonical_entities');
  }

  const replayGroups = new Map();
  for (const row of observations.filter((item) => item.source_ref)) {
    const key = [row.source_id, row.grain, row.source_ref].join('|');
    if (!replayGroups.has(key)) replayGroups.set(key, []);
    replayGroups.get(key).push(row);
  }
  const repeated = [...replayGroups.values()].filter((group) =>
    unique(group.map((row) => row.capture_id)).length > 1
  );
  const replaySplit = repeated.filter((group) =>
    unique(group.map((row) => row.canonical_entity_id)).length > 1
  );
  if (replaySplit.length) fail(resolutionFailures, 'replay_created_distinct_business_identity');

  const productById = new Map(products.map((product) => [String(product.canonical_product_id), product]));
  const offersByProduct = new Map();
  for (const row of observations.filter((item) => item.grain === 'offer' && item.canonical_entity_id)) {
    const parent = String(row.parent_entity_id || '');
    if (!offersByProduct.has(parent)) offersByProduct.set(parent, new Set());
    offersByProduct.get(parent).add(String(row.canonical_entity_id));
  }
  const convergedProducts = products.filter((product) =>
    Number(product.source_count) >= 2
    && (offersByProduct.get(String(product.canonical_product_id))?.size || 0) >= 2
  );
  if (!convergedProducts.length) fail(resolutionFailures, 'same_product_multi_source_convergence_not_proven');
  if (productById.size < 2) fail(resolutionFailures, 'distinct_products_not_proven');

  const conflictProducts = products.filter((product) =>
    (product.conflicts || []).length > 0
    && (product.conflicts || []).every((field) => product.resolved?.[field] === undefined)
  );
  if (!conflictProducts.length) fail(resolutionFailures, 'descriptive_conflict_preservation_not_proven');

  const economicLeaks = [];
  for (const product of products) {
    for (const field of Object.keys(product.resolved || {})) {
      if (ECONOMIC_PRODUCT_FIELDS.has(field)) {
        economicLeaks.push({ canonical_product_id: product.canonical_product_id, field });
      }
    }
  }
  if (economicLeaks.length) fail(integrityFailures, 'economic_fact_leaked_into_canonical_product');

  const promotedInactive = catalogRows.filter((row) =>
    row.candidate_state === 'imported_to_catalog'
    && row.product_id
    && row.lifecycle_status === 'candidate'
    && row.product_is_active === false
  );
  if (!promotedInactive.length) fail(catalogFailures, 'inactive_catalog_promotion_not_proven');
  if (!catalogRows.some((row) => row.product_sku_id)) fail(catalogFailures, 'product_sku_not_reconstructed');

  const refsByUnit = new Map();
  for (const ref of refs.filter((item) => item.grain === 'unit')) {
    const key = String(ref.canonical_entity_id);
    if (!refsByUnit.has(key)) refsByUnit.set(key, []);
    refsByUnit.get(key).push(ref);
  }
  const namespaceMixes = [...refsByUnit.entries()].filter(([, unitRefs]) =>
    unique(unitRefs.map((ref) => ref.source_id)).length > 1
  );
  if (namespaceMixes.length) fail(unitFailures, 'supplier_ref_mixed_between_namespaces');

  const resolved = resolutions.filter((item) => item.status === unitResolver.STATUS.RESOLVED);
  const ambiguous = resolutions.filter((item) => item.status === unitResolver.STATUS.AMBIGUOUS_UNIT);
  const noIdentity = resolutions.filter((item) => item.status === unitResolver.STATUS.NO_SUPPLIER_IDENTITY);
  const readErrors = resolutions.filter((item) => item.status === 'READ_ERROR');
  if (readErrors.length) fail(unitFailures, 'canonical_unit_read_error');
  if (!resolved.length) fail(unitFailures, 'exact_canonical_unit_not_resolved');
  if (!ambiguous.length) fail(unitFailures, 'ambiguous_unit_block_not_proven');
  if (!noIdentity.length) fail(commandabilityFailures, 'missing_soi_block_not_proven');

  for (const resolution of resolved) {
    const unitRefs = refsByUnit.get(String(resolution.canonical_unit_id)) || [];
    const exact = unitRefs.some((ref) =>
      String(ref.ref_value) === String(resolution.supplier_unit_ref)
    );
    if (!exact) fail(unitFailures, 'supplier_order_identity_not_backed_by_exact_unit_ref');
  }

  const guessedSoi = catalogRows.filter((row) =>
    sourceKind(row) === 'manual' && row.supplier_order_identity
  );
  if (guessedSoi.length) fail(commandabilityFailures, 'supplier_order_identity_guessed');

  const commandability = resolutions.map((resolution) => ({
    product_sku_id: resolution.product_sku_id,
    canonical_unit_id: resolution.canonical_unit_id || null,
    resolution_status: resolution.status,
    supplier_identity_exact: resolution.status === unitResolver.STATUS.RESOLVED,
    purchasing_status: resolution.status === unitResolver.STATUS.RESOLVED
      ? 'HARD_STOP'
      : 'BLOCKED_SUPPLIER_IDENTITY',
    place_order_invoked: false,
  }));
  if (commandability.some((item) => item.place_order_invoked)) {
    fail(commandabilityFailures, 'place_order_called');
  }

  const report = {
    report_version: REPORT_VERSION,
    generated_at: new Date().toISOString(),
    status: hardFailures.length ? 'FAIL' : 'PASS',
    authority: 'read_only_audit',
    sources: {
      required: [...REQUIRED_SOURCES],
      observed: observedKinds,
      allegro: observedKinds.includes('allegro') ? 'TESTED' : 'GAP_NO_STAGING_DATA',
    },
    integrity: section(integrityFailures, {
      observations: observations.length,
      provenance_preserved: provenanceLost.length === 0,
      economic_product_leaks: economicLeaks,
      provider_payload_opaque: true,
      place_order_invoked: false,
    }),
    resolution: section(resolutionFailures, {
      canonical_products: products.length,
      cross_source_products: convergedProducts.length,
      distinct_products: productById.size,
      repeated_source_identities: repeated.length,
      descriptive_conflicts_preserved: conflictProducts.length,
    }),
    catalog: section(catalogFailures, {
      linked_candidates: catalogRows.filter((row) => row.candidate_id).length,
      inactive_promotions: promotedInactive.length,
      product_skus: catalogRows.filter((row) => row.product_sku_id).length,
    }),
    unit_identity: section(unitFailures, {
      exact: resolved.length,
      ambiguous_blocked: ambiguous.length,
      read_errors: readErrors.length,
      namespace_mixes: namespaceMixes.map(([canonical_unit_id]) => canonical_unit_id),
    }),
    commandability: section(commandabilityFailures, {
      exact_soi: resolved.length,
      missing_soi_blocked: noIdentity.length,
      outcomes: commandability,
    }),
    hard_failures: hardFailures,
  };
  return report;
}

async function collectGoldenE2E(query = db.query.bind(db), resolveFn = unitResolver.resolveCanonicalUnitForProductSku) {
  const [sourceResult, observationResult, catalogResult, refResult, projectionReport] = await Promise.all([
    query(`
      SELECT source_id, adapter_type
        FROM sourcing_sources
       WHERE status = 'active'
       ORDER BY source_id
    `),
    query(`
      SELECT c.source_id, s.adapter_type, c.capture_id, o.observation_id,
             o.grain::text AS grain, o.source_ref, o.observed_at, o.normalized,
             rb.canonical_entity_id, ce.parent_entity_id, ce.status AS entity_status
        FROM sourcing_observations o
        JOIN sourcing_captures c ON c.capture_id = o.capture_id
        JOIN sourcing_sources s ON s.source_id = c.source_id
        LEFT JOIN sourcing_resolution_bindings rb
          ON rb.observation_id = o.observation_id AND rb.ended_at IS NULL
        LEFT JOIN sourcing_canonical_entities ce
          ON ce.canonical_entity_id = rb.canonical_entity_id
       ORDER BY c.source_id, o.observed_at, o.observation_id
    `),
    query(`
      SELECT sc.id AS candidate_id, sc.supplier_name, sc.supplier_product_id,
             sc.state AS candidate_state, sc.product_id,
             p.lifecycle_status, p.is_active AS product_is_active,
             sku.id AS product_sku_id, sku.supplier_sku, sku.supplier_unit_ref,
             sku.supplier_order_identity, sku.source, sku.is_active AS sku_is_active
        FROM sourcing_candidates sc
        LEFT JOIN products p ON p.id = sc.product_id
        LEFT JOIN product_skus sku ON sku.product_id = sc.product_id
       WHERE sc.normalized_source_contract IS NOT NULL
       ORDER BY sc.created_at, sc.id, sku.id
    `),
    query(`
      SELECT ce.canonical_entity_id, ce.grain::text AS grain,
             ref.source_id, ref.ref_kind, ref.ref_value
        FROM sourcing_canonical_entity_refs ref
        JOIN sourcing_canonical_entities ce
          ON ce.canonical_entity_id = ref.canonical_entity_id
       WHERE ce.status = 'active'
       ORDER BY ce.canonical_entity_id, ref.source_id, ref.ref_kind, ref.ref_value
    `),
    productProjection.collectCanonicalProductProjections(query),
  ]);

  const catalogRows = rowsOf(catalogResult);
  const skuIds = unique(catalogRows.map((row) => row.product_sku_id));
  const resolutions = [];
  for (const productSkuId of skuIds) {
    try {
      resolutions.push(await resolveFn(productSkuId, query));
    } catch (error) {
      resolutions.push({
        status: 'READ_ERROR',
        product_sku_id: productSkuId,
        error_code: error.code || 'CANONICAL_UNIT_READ_ERROR',
      });
    }
  }

  return buildGoldenE2EReport({
    sources: rowsOf(sourceResult),
    observations: rowsOf(observationResult),
    catalog_rows: catalogRows,
    refs: rowsOf(refResult),
    products: projectionReport.products || [],
    resolutions,
  });
}

module.exports = {
  REPORT_VERSION,
  REQUIRED_SOURCES,
  buildGoldenE2EReport,
  collectGoldenE2E,
  _sourceKind: sourceKind,
};
