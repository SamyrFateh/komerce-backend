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

const UNIT_REF_KINDS = Object.freeze({
  supplier_unit_ref: new Set(['supplier_unit_ref', 'unit.source_ref', 'source_ref', 'supplier_variant_id']),
  supplier_sku: new Set(['supplier_sku', 'unit.source_ref', 'source_ref']),
});

function stable(value) {
  if (value == null) return 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizedProvider(value) {
  return String(value || '').trim().toLowerCase() || null;
}

function providerFromNamespace(namespace) {
  const parts = String(namespace || '').trim().toLowerCase().split(':').filter(Boolean);
  if (!parts.length) return null;
  return parts[0] === 'api' ? (parts[1] || null) : parts[0];
}

function providerForRef(unit, ref) {
  const provenance = unit.provenance || [];
  const source = provenance.find((item) => String(item.source_id) === String(ref.namespace));
  return normalizedProvider(source?.adapter_type) || providerFromNamespace(ref.namespace);
}

function legacyRefClaims(sku) {
  const claims = [];
  if (sku.supplier_unit_ref != null && sku.supplier_unit_ref !== '') {
    claims.push({ field: 'supplier_unit_ref', value: String(sku.supplier_unit_ref) });
  }
  if (sku.supplier_sku != null && sku.supplier_sku !== '') {
    claims.push({ field: 'supplier_sku', value: String(sku.supplier_sku) });
  }
  return claims;
}

function matchingRefs(unit, sku, provider) {
  if (!provider) return [];
  const claims = legacyRefClaims(sku);
  return (unit.identity?.deterministic_refs || []).filter((ref) => {
    if (providerForRef(unit, ref) !== provider) return false;
    return claims.some((claim) =>
      claim.value === String(ref.value)
      && UNIT_REF_KINDS[claim.field]?.has(String(ref.kind))
    );
  });
}

/**
 * Read-only comparison of TWO differently-owned stock numbers.
 * The shadow observation is not a reservation, a catalog stock write,
 * a freshness verdict or permission to sell. Never turn UNKNOWN into zero.
 */
function nonnegativeStockNumber(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function compareShadowStockToCatalog({ unit, sku, matchedRefs = [], identityProved = false }) {
  const base = {
    product_sku_id: sku.id,
    canonical_unit_id: unit.canonical_unit_id,
    authority: 'shadow_read_only',
    freshness: 'UNVERIFIED',
    commercial_readiness: 'NOT_EVALUATED',
    status: 'UNKNOWN',
  };
  if (!identityProved) return { ...base, reason: 'IDENTITY_NOT_PROVEN' };
  if (sku.is_active === false || unit.current_state?.is_active === false ||
      ['removed', 'deleted', 'inactive'].includes(String(unit.current_state?.availability || '').toLowerCase())) {
    return { ...base, reason: 'INACTIVE_UNIT' };
  }

  // The canonical Unit can contain observations from several Sources.
  // Only compare the latest observation when its Source owns the exact
  // provider-scoped ref matched to this legacy SKU.
  const latest = unit.provenance?.at(-1);
  if (!unit.observed_at || !latest?.source_id ||
      String(latest.observed_at) !== String(unit.observed_at) ||
      !matchedRefs.some((ref) => String(ref.namespace) === String(latest.source_id)) ||
      unit.last_observation_delta?.reason === 'SOURCE_SCOPE_CHANGED') {
    return { ...base, reason: 'SOURCE_SCOPE_UNPROVEN' };
  }
  const observed = nonnegativeStockNumber(unit.current_state?.stock_available);
  if (observed === null) return { ...base, reason: 'SUPPLIER_STOCK_UNKNOWN' };
  const catalog = nonnegativeStockNumber(sku.stock);
  if (catalog === null) return { ...base, reason: 'CATALOG_STOCK_UNKNOWN' };

  return {
    ...base,
    status: 'COMPARED',
    reason: null,
    observed_supplier_stock: observed,
    catalog_sku_stock: catalog,
    observed_at: unit.observed_at,
    number_comparison: observed === catalog ? 'SAME_NUMBER' : 'DIFFERENT_NUMBER',
  };
}

function compareCanonicalOfferUnitWithLegacy({ offers = [], units = [], legacySkus = [] } = {}) {
  const parity = [];
  const stockObservations = [];
  const ambiguities = [];
  const missingIdentities = [];

  for (const sku of legacySkus) {
    const claims = legacyRefClaims(sku);
    const provider = normalizedProvider(sku.supplier_order_identity?.provider);
    if (!claims.length) {
      missingIdentities.push({ product_sku_id: sku.id, reason: 'legacy_missing_supplier_ref' });
      continue;
    }
    if (!provider) {
      missingIdentities.push({ product_sku_id: sku.id, refs: claims.map((item) => item.value), reason: 'legacy_provider_namespace_missing' });
      continue;
    }

    const matches = units.filter((unit) => matchingRefs(unit, sku, provider).length > 0);
    if (!matches.length) {
      missingIdentities.push({ product_sku_id: sku.id, provider, refs: claims.map((item) => item.value), reason: 'canonical_unit_not_found' });
    } else if (matches.length > 1) {
      ambiguities.push({ product_sku_id: sku.id, provider, canonical_unit_ids: matches.map((u) => u.canonical_unit_id) });
    } else {
      const unit = matches[0];
      const refs = matchingRefs(unit, sku, provider);
      const supplierUnitRefEqual = !sku.supplier_unit_ref ||
        refs.some((ref) => String(ref.value) === String(sku.supplier_unit_ref));
      const supplierOrderIdentityEqual =
        stable(sku.supplier_order_identity || null) === stable(unit.current_state?.supplier_order_identity || null);
      parity.push({
        product_sku_id: sku.id,
        canonical_unit_id: unit.canonical_unit_id,
        provider,
        matched_ref_keys: refs.map((ref) => `${ref.namespace}|${ref.kind}|${ref.value}`).sort(),
        supplier_unit_ref_equal: supplierUnitRefEqual,
        supplier_order_identity_equal: supplierOrderIdentityEqual,
      });
      stockObservations.push(compareShadowStockToCatalog({
        unit, sku, matchedRefs: refs,
        identityProved: supplierUnitRefEqual && supplierOrderIdentityEqual,
      }));
    }
  }

  const hardFailures = [];
  for (const item of parity) {
    if (!item.supplier_unit_ref_equal) {
      hardFailures.push({ product_sku_id: item.product_sku_id, reason: 'supplier_unit_ref_mismatch' });
    }
    if (!item.supplier_order_identity_equal) {
      hardFailures.push({ product_sku_id: item.product_sku_id, reason: 'supplier_order_identity_mismatch' });
    }
  }
  for (const item of ambiguities) {
    hardFailures.push({ product_sku_id: item.product_sku_id, reason: 'canonical_unit_ambiguity' });
  }

  return {
    offers: { projected: offers.length },
    units: { projected: units.length, legacy: legacySkus.length },
    parity,
    stock_observations: stockObservations,
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

module.exports = {
  compareCanonicalOfferUnitWithLegacy,
  compareShadowStockToCatalog,
  collectCanonicalOfferUnitComparison,
  _providerFromNamespace: providerFromNamespace,
};
