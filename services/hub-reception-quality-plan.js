/**
 * @komerce-arch
 * @role          hub-reception-quality-plan
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        PO, server market scope, explicit operator observations and transaction client
 * @outputs       validated per-SKU quantity partition; no mutation
 * @depends       none
 * @used-by       pending canonical reception integration (#5298)
 * @db-read      purchase_orders, purchase_lines, order_items, orders
 * @db-write     none
 * @db-txn       caller-owned transaction with PO and purchase-line locks
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

/**
 * Load the remaining quantities inside the SAME caller-owned transaction
 * that will persist the physical receipt. The PO header is locked first
 * (same ordering as purchasing confirmation and receiveSupplierPackage).
 * Read received quantities only after acquiring the line locks, not from
 * a stale snapshot taken before a competing receipt completes.
 *
 * Restricted to grouped POs; legacy single-order POs keep their existing
 * flow until separately certified. No writes or stock transitions here.
 */
async function lockReceptionQualityPlan(client,{purchaseOrderId,marketId,observations}={}) {
  if (!client || typeof client.query !== 'function' || !skuKey(purchaseOrderId) || !skuKey(marketId)) fail('HUB_QUALITY_SCOPE_INVALID');
  const {rows:[po]} = await client.query(
    'SELECT id, order_id, status, market_id FROM purchase_orders WHERE id=$1 FOR UPDATE',
    [purchaseOrderId]
  );
  if (!po || String(po.market_id) !== String(marketId)) fail('HUB_QUALITY_PO_SCOPE');
  if (po.order_id !== null) fail('HUB_QUALITY_GROUPED_PO_REQUIRED');
  if (['draft','pending','cancelled'].includes(po.status)) fail('HUB_QUALITY_PO_NOT_RECEIVABLE');
  const {rows:lines} = await client.query(
    `SELECT pl.id, pl.product_sku_id, o.market_id,
            purchase_line_effective_quantity(pl.cancelled_at, pl.settled_quantity, pl.confirmed_quantity, pl.quantity) AS effective
       FROM purchase_lines pl
       JOIN order_items oi ON oi.id=pl.order_item_id
       JOIN orders o ON o.id=oi.order_id
      WHERE pl.purchase_order_id=$1 AND pl.cancelled_at IS NULL
      ORDER BY o.created_at ASC, pl.id ASC
      FOR UPDATE OF pl`, [purchaseOrderId]
  );
  if (!lines.length || lines.some(l=>String(l.market_id)!==String(marketId))) fail('HUB_QUALITY_PO_SCOPE');
  const expected=[];
  for (const line of lines) {
    const {rows:[receipt]}=await client.query('SELECT purchase_line_received_quantity($1) AS received',[line.id]);
    const effective=Number(line.effective),received=Number(receipt?.received);
    if(!receipt||line.effective==null||receipt.received==null||!isQty(effective)||!isQty(received)||received>effective) fail('HUB_QUALITY_EXPECTED_INVALID');
    expected.push({product_sku_id:line.product_sku_id,remaining_quantity:effective-received});
  }
  return planReceptionQuality(expected,observations);
}

module.exports = {planReceptionQuality, lockReceptionQualityPlan, ReceptionQualityPlanError};
