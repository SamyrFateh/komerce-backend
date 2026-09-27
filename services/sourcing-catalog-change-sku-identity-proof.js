/**
 * @komerce-arch
 * @role          sourcing-catalog-change-sku-identity-proof
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        immutable_stock_delta_observation_id
 * @outputs       source_scoped_exact_catalog_sku_identity_or_explicit_blocker
 * @depends       db.js, services/sourcing-catalog-change-unit-resolution-proof.js
 * @used-by       tests/unit/sourcing-catalog-change-sku-identity-proof.test.js, tests/integration/catalog-change-sku-identity-proof-real-db.test.js
 * @db-read       sourcing_candidates, sourcing_captures, sourcing_observations, sourcing_resolution_bindings, sourcing_canonical_entities, product_skus, products
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CATALOG_CHANGE_INTAKE.md
 * @impact-areas  sourcing, catalog
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const unitProof = require('./sourcing-catalog-change-unit-resolution-proof');

const STATUS = Object.freeze({
  EXACT_CATALOG_SKU_IDENTITY: 'EXACT_CATALOG_SKU_IDENTITY',
  CANONICAL_UNIT_NOT_PROVEN: 'CANONICAL_UNIT_NOT_PROVEN',
  NO_EXACT_CATALOG_SKU: 'NO_EXACT_CATALOG_SKU',
  AMBIGUOUS_CATALOG_SKU: 'AMBIGUOUS_CATALOG_SKU',
  SOURCE_LINEAGE_AMBIGUOUS: 'SOURCE_LINEAGE_AMBIGUOUS',
  INACTIVE_CATALOG_SKU: 'INACTIVE_CATALOG_SKU',
  NOT_SKU_INVENTORY: 'NOT_SKU_INVENTORY',
});

function blocked(status, canonicalProof, extra = {}) {
  return {
    status, observation_id: canonicalProof?.observation_id || null,
    canonical_unit_status: canonicalProof?.status || null,
    ...extra,
    application_status: 'NOT_EVALUATED', applicable: false,
    freshness_evaluated: false, stock_authority_evaluated: false,
    reservations_evaluated: false, supplier_order_identity_consistency_evaluated: false,
  };
}

// This reader deliberately does NOT invert the Purchasing SKU->Unit helper:
// a provider-level ref match cannot prove the exact SOURCE ACCOUNT of an
// incoming delta. Require the positive source-scoped full-product import lineage
// and fail closed when the same catalog product has another recorded source.
async function proveExactCatalogSkuForStockDelta(observationId, query = db.query.bind(db), {
  canonicalProofFn = unitProof.proveExactCanonicalUnitForStockDelta,
} = {}) {
  const canonical = await canonicalProofFn(observationId, query);
  if (canonical.status !== unitProof.STATUS.EXACT_CANONICAL_UNIT) {
    return blocked(STATUS.CANONICAL_UNIT_NOT_PROVEN, canonical);
  }
  const sourceId = canonical.source_id;
  const { rows: [subject] } = await query(`
    SELECT o.normalized->>'product_ref' AS product_ref,
           o.normalized->>'unit_ref' AS unit_ref
      FROM sourcing_observations o
      JOIN sourcing_captures c ON c.capture_id = o.capture_id
     WHERE o.observation_id = $1::uuid AND c.source_id = $2
       AND o.normalized->>'observation_kind' = 'CATALOG_CHANGE_DELTA'
       AND o.grain::text = 'unit'
  `, [observationId, sourceId]);
  if (!subject?.product_ref || !subject?.unit_ref) {
    return blocked(STATUS.CANONICAL_UNIT_NOT_PROVEN, canonical);
  }

  // Query only exact supplier identities; neither variant labels nor product
  // names nor an equal textual unit ref from a different source is sufficient.
  // The prior product observation must have an active binding to the *same*
  // canonical product already established independently by the Unit proof.
  const { rows: matches } = await query(`
    SELECT DISTINCT sku.id AS product_sku_id, sku.product_id,
           sku.is_active, p.inventory_model,
           (SELECT COUNT(DISTINCT other_c.source_id)::int
              FROM sourcing_candidates other_sc
              JOIN sourcing_captures other_c
                ON other_sc.import_id = NULLIF(other_c.stats->>'import_id','')::uuid
             WHERE other_sc.product_id = sku.product_id
               AND other_c.source_id <> $1) AS competing_source_count
      FROM product_skus sku
      JOIN products p ON p.id = sku.product_id
      JOIN sourcing_candidates sc
        ON sc.product_id = sku.product_id AND sc.supplier_product_id = $2
      JOIN sourcing_captures c
        ON c.source_id = $1
       AND sc.import_id = NULLIF(c.stats->>'import_id','')::uuid
      JOIN sourcing_observations product_observation
        ON product_observation.capture_id = c.capture_id
       AND product_observation.grain::text = 'product'
       AND product_observation.source_ref = $2
       AND product_observation.normalized->>'observation_kind'
           IS DISTINCT FROM 'CATALOG_CHANGE_DELTA'
      JOIN sourcing_resolution_bindings product_binding
        ON product_binding.observation_id = product_observation.observation_id
       AND product_binding.ended_at IS NULL
       AND product_binding.canonical_entity_id = $4::uuid
     WHERE sku.source = 'SUPPLIER'
       AND sku.supplier_unit_ref = $3
       AND lower(sku.supplier_order_identity->>'provider') = $5
     LIMIT 3
  `, [sourceId, subject.product_ref, subject.unit_ref,
    canonical.canonical_product_id, sourceId.split(':')[1]]);
  if (!matches?.length) return blocked(STATUS.NO_EXACT_CATALOG_SKU, canonical);
  if (matches.length !== 1) {
    return blocked(STATUS.AMBIGUOUS_CATALOG_SKU, canonical, {
      matched_sku_count_at_least: matches.length,
    });
  }
  const sku = matches[0];
  if (Number(sku.competing_source_count) !== 0) {
    return blocked(STATUS.SOURCE_LINEAGE_AMBIGUOUS, canonical);
  }
  if (sku.is_active !== true) {
    return blocked(STATUS.INACTIVE_CATALOG_SKU, canonical);
  }
  if (sku.inventory_model !== 'SKU') {
    return blocked(STATUS.NOT_SKU_INVENTORY, canonical);
  }
  return {
    ...blocked(STATUS.EXACT_CATALOG_SKU_IDENTITY, canonical),
    product_sku_id: sku.product_sku_id,
    canonical_unit_id: canonical.canonical_unit_id,
    canonical_product_id: canonical.canonical_product_id,
    catalog_product_id: sku.product_id,
    source_id: sourceId,
    stock_available_observed: canonical.stock_available_observed,
    sku_identity_evaluated: true,
    authority: 'read_only_source_scoped_sku_identity',
  };
}

module.exports = { STATUS, proveExactCatalogSkuForStockDelta };
