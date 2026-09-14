/**
 * @komerce-arch
 * @role          catalog-product-read-cutover-trial
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        canonical_product_projection, proven_catalog_product_link
 * @outputs       reversible_internal_read_seam_trial_report
 * @depends       db.js, services/sourcing-canonical-product-projection.js, services/catalog-public-view.js
 * @used-by       scripts/catalog-product-read-cutover-trial-staging.js
 * @db-read       sourcing_canonical_entities, sourcing_resolution_bindings, sourcing_observations, sourcing_captures, sourcing_candidates, products
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CATALOG_PRODUCT_READ_CUTOVER_TRIAL.md
 * @impact-areas  sourcing, catalog
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const canonicalProjection = require('./sourcing-canonical-product-projection');
const { toPublicProduct } = require('./catalog-public-view');

const TRIAL_VERSION = 'catalog-product-read-cutover-trial-v1';

// V1 ne remplace que des champs de cuisine source, jamais les champs éditoriaux
// publics. Le but est de prouver la seam de lecture sans modifier la Boutique.
const SOURCE_FIELD_MAPPING = Object.freeze({
  product_name: 'name_source',
  description: 'description_source',
  source_locale: 'source_locale',
});

const PROTECTED_FIELDS = Object.freeze([
  'id',
  'product_ref',
  'sku',
  'name',
  'description',
  'category',
  'subcategory',
  'price_aed',
  'price_kmf',
  'price_eur',
  'weight_kg',
  'dimensions_cm',
  'stock',
  'image_url',
  'images',
  'badge',
  'emoji',
  'fragility',
  'promo_pct',
  'is_available',
  'customs_risk_coeff',
  'has_couture',
  'sourcing_source',
  'requires_secure_transport',
  'unsold_price_kmf',
  'unsold_channel',
  'has_variants',
  'is_active',
  'lifecycle_status',
  'inventory_model',
]);

function stableValue(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function applyCanonicalSourceReadSeam(legacyRow, projectedProduct) {
  const hybrid = { ...legacyRow };
  const decisions = {};
  let canonicalFieldsApplied = 0;
  let conflictFallbacks = 0;
  let absentFallbacks = 0;

  for (const [canonicalField, legacyField] of Object.entries(SOURCE_FIELD_MAPPING)) {
    const projection = projectedProduct?.fields?.[canonicalField];
    if (projection?.status === 'CONSENSUS') {
      hybrid[legacyField] = clone(projection.value);
      decisions[legacyField] = {
        status: 'CANONICAL_CONSENSUS_APPLIED',
        canonical_field: canonicalField,
        value: clone(projection.value),
      };
      canonicalFieldsApplied += 1;
    } else if (projection?.status === 'CONFLICT_PRESERVED') {
      decisions[legacyField] = {
        status: 'LEGACY_FALLBACK_CONFLICT',
        canonical_field: canonicalField,
        legacy_value: legacyRow?.[legacyField] ?? null,
        candidate_values: (projection.candidates || []).map((candidate) => clone(candidate.value)),
      };
      conflictFallbacks += 1;
    } else {
      decisions[legacyField] = {
        status: 'LEGACY_FALLBACK_ABSENT',
        canonical_field: canonicalField,
        legacy_value: legacyRow?.[legacyField] ?? null,
      };
      absentFallbacks += 1;
    }
  }

  const protectedFieldChanges = PROTECTED_FIELDS.filter(
    (field) => stableValue(legacyRow?.[field]) !== stableValue(hybrid?.[field])
  );
  const legacyPublic = toPublicProduct(legacyRow);
  const hybridPublic = toPublicProduct(hybrid);
  const publicContractEqual = stableValue(legacyPublic) === stableValue(hybridPublic);

  return {
    hybrid_row: hybrid,
    product_id: legacyRow.id,
    canonical_product_id: projectedProduct?.canonical_product_id || null,
    source_count: projectedProduct?.source_count || 0,
    projection_status: projectedProduct?.projection_status || null,
    decisions,
    summary: {
      canonical_fields_applied: canonicalFieldsApplied,
      conflict_fallbacks: conflictFallbacks,
      absent_fallbacks: absentFallbacks,
      protected_field_changes: protectedFieldChanges.length,
      public_contract_equal: publicContractEqual,
    },
    protected_field_changes: protectedFieldChanges,
    status: protectedFieldChanges.length || !publicContractEqual ? 'FAIL' : 'SAFE',
  };
}

async function collectCatalogProductReadCutoverTrial(query = db.query.bind(db)) {
  const projectionReport = await canonicalProjection.collectCanonicalProductProjections(query);
  const projectionById = new Map(
    (projectionReport.products || []).map((product) => [product.canonical_product_id, product])
  );

  const linkResult = await query(`
    SELECT DISTINCT sc.product_id,
           ce.canonical_entity_id
      FROM sourcing_candidates sc
      JOIN sourcing_captures c
        ON sc.import_id = NULLIF(c.stats->>'import_id', '')::uuid
      JOIN sourcing_observations o
        ON o.capture_id = c.capture_id
       AND o.grain::text = 'product'
       AND o.source_ref = sc.supplier_product_id
      JOIN sourcing_resolution_bindings rb
        ON rb.observation_id = o.observation_id
       AND rb.ended_at IS NULL
      JOIN sourcing_canonical_entities ce
        ON ce.canonical_entity_id = rb.canonical_entity_id
       AND ce.grain::text = 'product'
       AND ce.status = 'active'
     WHERE sc.product_id IS NOT NULL
     ORDER BY sc.product_id, ce.canonical_entity_id
  `);

  const canonicalIdsByProduct = new Map();
  for (const row of linkResult.rows || []) {
    if (!canonicalIdsByProduct.has(row.product_id)) canonicalIdsByProduct.set(row.product_id, new Set());
    canonicalIdsByProduct.get(row.product_id).add(row.canonical_entity_id);
  }

  const ambiguousLinks = [...canonicalIdsByProduct.entries()]
    .filter(([, ids]) => ids.size !== 1)
    .map(([productId, ids]) => ({ product_id: productId, canonical_product_ids: [...ids].sort() }));

  const productIds = [...canonicalIdsByProduct.keys()];
  const productResult = productIds.length
    ? await query('SELECT * FROM products WHERE id = ANY($1::uuid[]) ORDER BY id', [productIds])
    : { rows: [] };
  const productById = new Map((productResult.rows || []).map((row) => [row.id, row]));

  const trials = [];
  for (const [productId, canonicalIds] of canonicalIdsByProduct.entries()) {
    if (canonicalIds.size !== 1) continue;
    const canonicalProductId = [...canonicalIds][0];
    const legacyRow = productById.get(productId);
    const projection = projectionById.get(canonicalProductId);
    if (!legacyRow || !projection) continue;
    trials.push(applyCanonicalSourceReadSeam(legacyRow, projection));
  }

  const failed = trials.filter((trial) => trial.status === 'FAIL');
  const appliedFields = trials.reduce((sum, trial) => sum + trial.summary.canonical_fields_applied, 0);
  const safeTrials = trials.filter((trial) => trial.status === 'SAFE').length;

  let status = 'PASS';
  const blockers = [];
  const hardFailures = [];
  if (!trials.length) {
    status = 'BLOCKED';
    blockers.push('no_proven_catalog_product_link');
  }
  if (ambiguousLinks.length) {
    status = 'FAIL';
    hardFailures.push('catalog_product_linked_to_multiple_canonical_products');
  }
  if (failed.length) {
    status = 'FAIL';
    hardFailures.push('protected_or_public_contract_changed');
  }

  return {
    trial_version: TRIAL_VERSION,
    generated_at: new Date().toISOString(),
    authority: 'controlled_read_trial',
    route_authority_unchanged: true,
    public_contract_unchanged: failed.length === 0,
    summary: {
      linked_catalog_products: canonicalIdsByProduct.size,
      trials: trials.length,
      safe_trials: safeTrials,
      canonical_fields_applied: appliedFields,
      ambiguous_links: ambiguousLinks.length,
      failed_trials: failed.length,
    },
    ambiguous_links: ambiguousLinks,
    trials,
    verdict: {
      status,
      blockers,
      hard_failures: [...new Set(hardFailures)],
      ready_for_route_canary: status === 'PASS' && trials.length > 0 && appliedFields > 0,
      safe_fallback_proven: status === 'PASS' && trials.length > 0,
    },
  };
}

module.exports = {
  TRIAL_VERSION,
  SOURCE_FIELD_MAPPING,
  PROTECTED_FIELDS,
  applyCanonicalSourceReadSeam,
  buildReadSeamTrial: applyCanonicalSourceReadSeam,
  collectCatalogProductReadCutoverTrial,
  _stableValue: stableValue,
};
