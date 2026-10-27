'use strict';
/**
 * R&D-only checkpoint: inspect the actual persisted PO before supplier
 * confirmation. It is evidence of *absence of recorded execution*, not
 * proof that the supplier was never contacted outside Komerce.
 *
 * No writes, no reliance on generated UUID equality across two Goldens.
 */
const str = x => x == null ? null : String(x);
const number = x => Number(x);
function assessUnsubmittedPo(facts, expected) {
  const {po, line, executionCount, paymentCount} = facts || {};
  const {shape, poId, orderId, orderItemId} = expected || {};
  if (!po || !line || !['grouped', 'historical'].includes(shape)) {
    throw new Error('Canonical persisted PO, line and expected shape required');
  }
  const persistedShape = po.order_id == null ? 'grouped' : 'historical';
  const issues = [];
  const check = (valid, code) => { if (!valid) issues.push(code); };
  check(str(po.id) === str(poId), 'PO_IDENTITY_MISMATCH');
  check(persistedShape === shape, 'PO_SHAPE_MISMATCH');
  check(po.status === (shape === 'grouped' ? 'draft' : 'pending'), 'PO_UNSUBMITTED_STATUS_MISMATCH');
  check(po.supplier_order_id == null, 'SUPPLIER_ORDER_ALREADY_RECORDED');
  check(str(line.purchase_order_id) === str(poId), 'PURCHASE_LINE_NOT_BOUND_TO_PO');
  check(str(line.order_item_id) === str(orderItemId), 'PURCHASE_LINE_FOREIGN_ITEM');
  if (shape === 'historical') {
    check(str(po.order_id) === str(orderId), 'PO_FOREIGN_ORDER');
    check(str(po.order_item_id) === str(orderItemId), 'PO_FOREIGN_ITEM');
  } else {
    check(po.order_id == null && po.order_item_id == null, 'GROUPED_PO_HAS_ORDER_OWNER');
  }
  const exec = number(executionCount), payments = number(paymentCount);
  check(Number.isInteger(exec) && exec === 0, 'EXECUTION_BEFORE_SUBMISSION');
  check(Number.isInteger(payments) && payments === 0, 'PAYMENT_BEFORE_SUBMISSION');
  return {
    schema: 'golden-po-unsubmitted-checkpoint/v1',
    persisted_shape: persistedShape,
    persisted_status: po.status,
    execution_count: exec,
    payment_count: payments,
    verdict: issues.length ? 'UNSUBMITTED_PO_CONTRADICTION_HYPOTHESIS' : 'NO_RECORDED_SUPPLIER_EXECUTION',
    issues,
    note: 'R&D observation, not an authority for supplier submission or Hub receipt',
  };
}
async function collectUnsubmittedPo(db, expected) {
  if (!db || typeof db.query !== 'function') throw Error('SQL executor required');
  const one = async (sql, values) => (await db.query(sql, values)).rows[0];
  const po = await one('SELECT id,order_id,order_item_id,status,supplier_order_id FROM purchase_orders WHERE id=$1', [expected.poId]);
  const line = await one('SELECT purchase_order_id,order_item_id FROM purchase_lines WHERE id=$1', [expected.lineId]);
  const e = await one('SELECT count(*)::integer AS n FROM supplier_execution_orders WHERE purchase_order_id=$1', [expected.poId]);
  const p = await one('SELECT count(*)::integer AS n FROM supplier_execution_payments WHERE purchase_order_id=$1', [expected.poId]);
  return assessUnsubmittedPo({po,line,executionCount:e?.n,paymentCount:p?.n}, expected);
}
module.exports = {assessUnsubmittedPo,collectUnsubmittedPo};
