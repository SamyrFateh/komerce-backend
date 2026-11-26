/**
 * @komerce-arch
 * @role          hub-reception-quality-plan
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        canonical expected SKU quantities under transaction lock; explicit operator observations
 * @outputs       validated per-SKU quantity partition; no mutation
 * @depends       none
 * @used-by       pending canonical reception integration (#5298)
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     explicit_physical_observation_no_implicit_receipt
 * @impact-areas logistics, purchasing
 * @version      2026-11-v1
 */
'use strict';

class ReceptionQualityPlanError extends Error {
  constructor(code) { super(code); this.code = code; this.status = 400; }
}
const fail = code => { throw new ReceptionQualityPlanError(code); };
const isQty = value => Number.isSafeInteger(value) && value >= 0;
const skuKey = value => typeof value === 'string' && value.trim() === value && value.length > 0;

/**
 * Build the partition before any write. expectedRows must be the canonical
 * remaining quantities, NOT values supplied by the browser. Repeated expected
 * SKU rows (e.g. several customer allocations) are aggregated, never treated
 * as duplicate observations. FIFO allocation is a separate transactional step.
 * No defaults are inferred server-side, even for one expected unit.
 */
function planReceptionQuality(expectedRows, observations) {
  if (!Array.isArray(expectedRows) || !Array.isArray(observations)) fail('HUB_QUALITY_INPUT_INVALID');
  const expected = new Map();
  for (const row of expectedRows) {
    if (!row || !skuKey(row.product_sku_id) || !isQty(row.remaining_quantity)) fail('HUB_QUALITY_EXPECTED_INVALID');
    const count = (expected.get(row.product_sku_id) || 0) + row.remaining_quantity;
    if (!isQty(count)) fail('HUB_QUALITY_EXPECTED_INVALID');
    expected.set(row.product_sku_id, count);
  }
  for (const [sku, qty] of expected) if (qty === 0) expected.delete(sku);
  if (!expected.size) fail('HUB_QUALITY_NO_REMAINING');
  const seen = new Set(), lines = [];
  for (const row of observations) {
    if (!row || !skuKey(row.product_sku_id) || !expected.has(row.product_sku_id)) fail('HUB_QUALITY_UNKNOWN_SKU');
    const sku = row.product_sku_id, qty = expected.get(sku);
    if (seen.has(sku)) fail('HUB_QUALITY_DUPLICATE_SKU');
    seen.add(sku);
    if (!isQty(row.received_quantity) || !isQty(row.rejected_quantity) ||
        row.received_quantity > qty || row.rejected_quantity > row.received_quantity) fail('HUB_QUALITY_QUANTITY_INVALID');
    if (qty > 1 && row.quantity_confirmed !== true) fail('HUB_QUALITY_QUANTITY_UNCONFIRMED');
    lines.push({product_sku_id:sku,expected_quantity:qty,received_quantity:row.received_quantity,
      conforming_quantity:row.received_quantity-row.rejected_quantity,
      rejected_quantity:row.rejected_quantity,missing_quantity:qty-row.received_quantity});
  }
  if (seen.size !== expected.size) fail('HUB_QUALITY_OBSERVATION_INCOMPLETE');
  const totals = {expected_quantity:0,received_quantity:0,conforming_quantity:0,rejected_quantity:0,missing_quantity:0};
  for (const line of lines) for (const field of Object.keys(totals)) {
    totals[field] += line[field];
    if (!isQty(totals[field])) fail('HUB_QUALITY_QUANTITY_INVALID');
  }
  return {lines, totals};
}

module.exports = {planReceptionQuality, ReceptionQualityPlanError};
