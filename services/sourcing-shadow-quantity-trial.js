/**
 * @komerce-arch
 * @role          sourcing-shadow-quantity-trial
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        read_only_offer_unit_parity_report, sku_quantity_lines, explicit_time_policy
 * @outputs       read_only_observed_quantity_evidence
 * @depends       none
 * @used-by       tests/unit/sourcing-shadow-quantity-trial.test.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/AMENDEMENT_SOURCING_CONTINUITE_DELTA_DISPONIBILITE_V1.md
 * @impact-areas  sourcing
 * @version       2026-09
 */
'use strict';

// Pure trial ONLY. Observed supplier stock is not reserved commercial inventory.
// Never call this from checkout, payment, publication or purchasing readiness.
const STATUS = Object.freeze({
  OBSERVED_SUFFICIENT: 'OBSERVED_SUFFICIENT',
  SHORTFALL: 'SHORTFALL',
  UNKNOWN: 'UNKNOWN',
});

function positiveQuantity(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}
function stock(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function evaluateShadowQuantityTrial({ items, report, now, maxObservationAgeMs } = {}) {
  const base = {
    authority: 'shadow_read_only',
    commercial_readiness: 'NOT_EVALUATED',
    supplier_reservation: 'NOT_PROVED',
    checkout_gate_invoked: false,
    provider_called: false,
    status: STATUS.UNKNOWN,
  };
  const at = timestamp(now);
  if (at === null || !positiveQuantity(maxObservationAgeMs) ||
      !Array.isArray(items) || items.length === 0 || items.length > 1000 ||
      !report || report.authority_unchanged !== true ||
      !Array.isArray(report.stock_observations) ||
      !Array.isArray(report.ambiguities) ||
      !Array.isArray(report.hard_failures) ||
      !Array.isArray(report.missing_identities)) {
    return { ...base, reason: 'INVALID_TRIAL_INPUT', sku_evidence: [] };
  }

  const demand = new Map();
  for (const line of items) {
    const id = line && typeof line.sku_id === 'string' ? line.sku_id.trim() : '';
    const qty = positiveQuantity(line?.quantity);
    if (!id || qty === null) return { ...base, reason: 'INVALID_QUANTITY_OR_SKU', sku_evidence: [] };
    const total = (demand.get(id) || 0) + qty;
    if (!Number.isSafeInteger(total)) return { ...base, reason: 'QUANTITY_OVERFLOW', sku_evidence: [] };
    demand.set(id, total);
  }

  const bySku = new Map();
  const canonicalCounts = new Map();
  for (const observation of report.stock_observations) {
    const id = observation?.product_sku_id;
    if (typeof id !== 'string' || !id.trim()) continue;
    const existing = bySku.get(id) || [];
    existing.push(observation);
    bySku.set(id, existing);
    if (observation.canonical_unit_id) {
      canonicalCounts.set(observation.canonical_unit_id, (canonicalCounts.get(observation.canonical_unit_id) || 0) + 1);
    }
  }

  const skuEvidence = [];
  for (const [skuId, quantity] of demand) {
    const result = { sku_id: skuId, requested_quantity: quantity, status: STATUS.UNKNOWN };
    const observations = bySku.get(skuId) || [];
    if (report.ambiguities.some(e => e.product_sku_id === skuId) ||
        report.hard_failures.some(e => e.product_sku_id === skuId) ||
        report.missing_identities.some(e => e.product_sku_id === skuId) ||
        observations.length !== 1 || !observations[0].canonical_unit_id ||
        canonicalCounts.get(observations[0].canonical_unit_id) !== 1) {
      result.reason = 'CANONICAL_IDENTITY_UNPROVEN';
      skuEvidence.push(result);
      continue;
    }
    const observed = observations[0];
    if (observed.authority !== 'shadow_read_only' ||
        observed.commercial_readiness !== 'NOT_EVALUATED' ||
        observed.status !== 'COMPARED') {
      result.reason = 'OBSERVATION_UNKNOWN';
      skuEvidence.push(result);
      continue;
    }
    const ageTime = timestamp(observed.observed_at);
    if (ageTime === null || ageTime > at || at - ageTime > maxObservationAgeMs) {
      result.reason = 'OBSERVATION_AGE_UNPROVEN';
      skuEvidence.push(result);
      continue;
    }
    const supplierStock = stock(observed.observed_supplier_stock);
    const catalogStock = stock(observed.catalog_sku_stock);
    if (supplierStock === null || catalogStock === null) {
      result.reason = 'STOCK_UNKNOWN';
      skuEvidence.push(result);
      continue;
    }

    result.observed_at = observed.observed_at;
    result.observation_age_ms = at - ageTime;
    result.supplier_observed_stock = supplierStock;
    result.catalog_sku_stock = catalogStock;
    result.status = supplierStock < quantity || catalogStock < quantity
      ? STATUS.SHORTFALL : STATUS.OBSERVED_SUFFICIENT;
    result.reason = result.status === STATUS.SHORTFALL
      ? (supplierStock < quantity ? 'SUPPLIER_OBSERVED_SHORTFALL' : 'CATALOG_SNAPSHOT_SHORTFALL')
      : 'OBSERVED_QUANTITY_ONLY';
    skuEvidence.push(result);
  }
  const status = skuEvidence.some(r => r.status === STATUS.UNKNOWN) ? STATUS.UNKNOWN
    : skuEvidence.some(r => r.status === STATUS.SHORTFALL) ? STATUS.SHORTFALL
      : STATUS.OBSERVED_SUFFICIENT;
  return { ...base, status, reason: 'READ_ONLY_TRIAL', sku_evidence: skuEvidence };
}

module.exports = { STATUS, evaluateShadowQuantityTrial };
