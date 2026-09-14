/**
 * @komerce-arch
 * @role          sourcing-canonical-unit-product-sku-resolution
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        product_sku_id
 * @outputs       exact_canonical_unit_resolution
 * @depends       db.js, services/sourcing-catalog-product-linkage.js, services/sourcing-canonical-unit-projection.js
 * @used-by       services/suppliers/canonical-unit-purchasing-gate.js
 * @db-read       product_skus, sourcing_canonical_entities, sourcing_canonical_entity_refs, sourcing_sources
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CANONICAL_UNIT_PURCHASING.md
 * @impact-areas  sourcing, purchasing
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const linkage = require('./sourcing-catalog-product-linkage');
const projection = require('./sourcing-canonical-unit-projection');

const STATUS = Object.freeze({
  RESOLVED: 'RESOLVED',
  NO_UNIT: 'NO_UNIT',
  AMBIGUOUS_UNIT: 'AMBIGUOUS_UNIT',
  NO_SUPPLIER_IDENTITY: 'NO_SUPPLIER_IDENTITY',
  INACTIVE_UNIT: 'INACTIVE_UNIT',
});

async function resolveCanonicalUnitForProductSku(
  productSkuId,
  query = db.query.bind(db),
  {
    productLinkageFn = linkage.findCanonicalProductIdsForCatalogProduct,
    projectionFn = projection.collectCanonicalUnitProjectionById,
  } = {}
) {
  const skuResult = await query(`
    SELECT id, product_id, supplier_sku, supplier_unit_ref,
           supplier_order_identity, stock, price_kmf, is_active, source
      FROM product_skus WHERE id = $1
  `, [productSkuId]);
  const sku = skuResult.rows?.[0];
  if (!sku) return { status: STATUS.NO_UNIT, product_sku_id: productSkuId };

  const canonicalProductIds = await productLinkageFn(sku.product_id, query);
  if (!canonicalProductIds.length) {
    return { status: STATUS.NO_UNIT, product_sku_id: productSkuId, legacy_sku: sku };
  }

  const refs = [...new Set([sku.supplier_unit_ref, sku.supplier_sku].filter(Boolean).map(String))];
  if (!refs.length) return { status: STATUS.NO_UNIT, product_sku_id: productSkuId, legacy_sku: sku };
  const provider = String(sku.supplier_order_identity?.provider || '').trim().toLowerCase() || null;
  const unitResult = await query(`
    SELECT DISTINCT unit.canonical_entity_id
      FROM sourcing_canonical_entities unit
      JOIN sourcing_canonical_entities offer ON offer.canonical_entity_id = unit.parent_entity_id
      JOIN sourcing_canonical_entity_refs ref ON ref.canonical_entity_id = unit.canonical_entity_id
      JOIN sourcing_sources source ON source.source_id = ref.source_id
     WHERE unit.grain::text = 'unit' AND unit.status = 'active'
       AND offer.grain::text = 'offer' AND offer.status = 'active'
       AND offer.parent_entity_id = ANY($1::uuid[])
       AND ref.ref_kind IN ('unit.source_ref', 'source_ref', 'supplier_unit_ref', 'supplier_sku', 'supplier_variant_id')
       AND ref.ref_value = ANY($2::text[])
       AND ($3::text IS NULL OR lower(source.adapter_type) = $3)
     ORDER BY unit.canonical_entity_id
  `, [canonicalProductIds, refs, provider]);

  const unitIds = (unitResult.rows || []).map((row) => row.canonical_entity_id);
  if (!unitIds.length) return { status: STATUS.NO_UNIT, product_sku_id: productSkuId, legacy_sku: sku };
  if (unitIds.length > 1) {
    return { status: STATUS.AMBIGUOUS_UNIT, product_sku_id: productSkuId, canonical_unit_ids: unitIds, legacy_sku: sku };
  }

  const unit = await projectionFn(unitIds[0], query);
  if (!unit) return { status: STATUS.NO_UNIT, product_sku_id: productSkuId, legacy_sku: sku };
  const state = unit.current_state || {};
  if (state.is_active === false || ['deleted', 'removed', 'inactive'].includes(String(state.availability || '').toLowerCase())) {
    return { status: STATUS.INACTIVE_UNIT, product_sku_id: productSkuId, canonical_unit: unit, legacy_sku: sku };
  }
  if (!state.supplier_order_identity) {
    return { status: STATUS.NO_SUPPLIER_IDENTITY, product_sku_id: productSkuId, canonical_unit: unit, legacy_sku: sku };
  }
  return {
    status: STATUS.RESOLVED,
    product_sku_id: productSkuId,
    canonical_unit_id: unit.canonical_unit_id,
    supplier_unit_ref: unit.identity?.deterministic_refs?.find((ref) => ref.kind === 'supplier_unit_ref' || ref.kind === 'source_ref')?.value || sku.supplier_unit_ref,
    supplier_order_identity: state.supplier_order_identity,
    canonical_unit: unit,
    legacy_sku: sku,
  };
}

module.exports = { STATUS, resolveCanonicalUnitForProductSku };
