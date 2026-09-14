/**
 * @komerce-arch
 * @role          sourcing-canonical-offer-unit-comparison
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        shadow_offer_unit_projections, legacy_product_skus
 * @outputs       read_only_offer_unit_parity_report
 * @depends       db.js, services/sourcing-canonical-offer-projection.js, services/sourcing-canonical-unit-projection.js
 * @used-by       scripts/future-shadow-comparison
 * @db-read       sourcing_canonical_entities, product_skus
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CANONICAL_PRODUCT_OFFER_UNIT.md
 * @impact-areas  sourcing, purchasing
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const offerProjection = require('./sourcing-canonical-offer-projection');
const unitProjection = require('./sourcing-canonical-unit-projection');

function compareCanonicalOfferUnitWithLegacy({ offers = [], units = [], legacySkus = [] } = {}) {
  const unitByRef = new Map();
  for (const unit of units) {
    for (const ref of unit.identity?.deterministic_refs || []) {
      if (!unitByRef.has(String(ref.value))) unitByRef.set(String(ref.value), []);
      unitByRef.get(String(ref.value)).push(unit);
    }
  }

  const parity = [];
  const ambiguities = [];
  const missingIdentities = [];
  for (const sku of legacySkus) {
    const refs = [sku.supplier_unit_ref, sku.supplier_sku].filter(Boolean).map(String);
    const matches = [...new Set(refs.flatMap((ref) => unitByRef.get(ref) || []))];
    if (!refs.length) missingIdentities.push({ product_sku_id: sku.id, reason: 'legacy_missing_supplier_ref' });
    else if (!matches.length) missingIdentities.push({ product_sku_id: sku.id, refs, reason: 'canonical_unit_not_found' });
    else if (matches.length > 1) ambiguities.push({ product_sku_id: sku.id, canonical_unit_ids: matches.map((u) => u.canonical_unit_id) });
    else {
      const unit = matches[0];
      parity.push({
        product_sku_id: sku.id,
        canonical_unit_id: unit.canonical_unit_id,
        supplier_unit_ref_equal: !sku.supplier_unit_ref || (unit.identity.deterministic_refs || []).some((ref) => String(ref.value) === String(sku.supplier_unit_ref)),
        supplier_order_identity_equal: JSON.stringify(sku.supplier_order_identity || null) === JSON.stringify(unit.current_state?.supplier_order_identity || null),
      });
    }
  }
  const hardFailures = parity.filter((item) => !item.supplier_unit_ref_equal).map((item) => ({
    product_sku_id: item.product_sku_id,
    reason: 'supplier_unit_ref_mismatch',
  }));
  return {
    offers: { projected: offers.length },
    units: { projected: units.length, legacy: legacySkus.length },
    parity,
    ambiguities,
    missing_identities: missingIdentities,
    hard_failures: hardFailures,
    authority_unchanged: true,
  };
}


async function collectCanonicalOfferUnitComparison(
  query = db.query.bind(db),
  {
    offerProjectionFn = offerProjection.collectCanonicalOfferProjectionById,
    unitProjectionFn = unitProjection.collectCanonicalUnitProjectionById,
  } = {}
) {
  const entityResult = await query(`
    SELECT canonical_entity_id, grain::text AS grain
      FROM sourcing_canonical_entities
     WHERE grain::text IN ('offer', 'unit') AND status = 'active'
     ORDER BY grain, canonical_entity_id
  `);
  const offers = [];
  const units = [];
  for (const entity of entityResult.rows || []) {
    if (entity.grain === 'offer') {
      const projected = await offerProjectionFn(entity.canonical_entity_id, query);
      if (projected) offers.push(projected);
    } else {
      const projected = await unitProjectionFn(entity.canonical_entity_id, query);
      if (projected) units.push(projected);
    }
  }
  const legacyResult = await query(`
    SELECT id, product_id, supplier_sku, supplier_unit_ref,
           supplier_order_identity, variant_combo, stock, price_kmf, is_active, source
      FROM product_skus
     WHERE source = 'SUPPLIER'
     ORDER BY id
  `);
  return {
    report_version: 'canonical-offer-unit-shadow-comparison-v1',
    generated_at: new Date().toISOString(),
    ...compareCanonicalOfferUnitWithLegacy({ offers, units, legacySkus: legacyResult.rows || [] }),
  };
}

module.exports = { compareCanonicalOfferUnitWithLegacy, collectCanonicalOfferUnitComparison };
