'use strict';

/**
 * @komerce-arch
 * @role          golden-e2e-cockpit-projection
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   medium
 * @inputs        authorized_golden_order
 * @outputs       read_only_golden_boundary_evidence
 * @depends       services/hub-inbound-reconciliation, services/customer-handoff-reconciliation, services/order-financial-closure-reconciliation
 * @used-by       routes/admin-order-360
 * @db-read       purchase_lines, order_items, supplier_execution_payments, purchase_orders, supplier_execution_fulfillments, supplier_execution_orders, customs_shipment_parcels, parcels, customs_shipments
 * @db-write      none
 * @db-txn        none
 * @doctrine      projection_only_no_business_authority
 * @impact-areas  dashboard, e2e-certification
 * @version       2026-10
 */

/**
 * Read-only projection for the human Golden Order cockpit.
 * It never mutates business state: every green step is derived from canonical persisted facts.
 */
const { reconcileHubInbound } = require('./hub-inbound-reconciliation');
const { reconcileCustomerHandoff } = require('./customer-handoff-reconciliation');
const { reconcileOrderFinancialClose } = require('./order-financial-closure-reconciliation');

async function exists(db, sql, orderId) {
  const result = await db.query(sql, [orderId]);
  return Boolean(result.rows[0] && result.rows[0].ok);
}

async function projectGoldenEvidence(db, order) {
  const orderId = order.id;
  const purchasing = await exists(db,
    'SELECT EXISTS(SELECT 1 FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id WHERE oi.order_id=$1 AND pl.purchase_order_id IS NOT NULL) ok', orderId);
  const supplierPayment = await exists(db,
    "SELECT EXISTS(SELECT 1 FROM supplier_execution_payments p JOIN purchase_orders po ON po.id=p.purchase_order_id JOIN purchase_lines pl ON pl.purchase_order_id=po.id JOIN order_items oi ON oi.id=pl.order_item_id WHERE oi.order_id=$1 AND p.status='succeeded' AND p.reconciliation_status='matched' AND p.real_debit_verified=TRUE) ok", orderId);
  const fulfillmentResult = await db.query(
    "SELECT f.id, f.tracking_number FROM supplier_execution_fulfillments f JOIN supplier_execution_orders e ON e.id=f.supplier_execution_order_id JOIN purchase_orders po ON po.id=e.purchase_order_id JOIN purchase_lines pl ON pl.purchase_order_id=po.id JOIN order_items oi ON oi.id=pl.order_item_id WHERE oi.order_id=$1 AND f.reconciliation_status='matched' ORDER BY f.created_at DESC LIMIT 1", [orderId]);
  const fulfillment = fulfillmentResult.rows[0] || null;
  const customs = await exists(db,
    "SELECT EXISTS(SELECT 1 FROM customs_shipment_parcels csp JOIN parcels p ON p.id=csp.parcel_id JOIN customs_shipments cs ON cs.id=csp.shipment_id WHERE p.order_id=$1 AND cs.status IN ('declared','confirmed') AND p.customs_cleared_at IS NOT NULL) ok", orderId);
  const relayAvailable = await exists(db,
    "SELECT EXISTS(SELECT 1 FROM parcels WHERE order_id=$1 AND status IN ('available','collected')) ok", orderId);

  const inbound = fulfillment
    ? await reconcileHubInbound(db, { supplierFulfillmentId: fulfillment.id })
    : { verdict: 'PENDING', reason: 'SUPPLIER_FULFILLMENT_NOT_FOUND' };
  const handoff = await reconcileCustomerHandoff(db, { orderId });
  const close = await reconcileOrderFinancialClose(db, { orderId });

  const raw = [
    ['CLIENT_ORDER', true, order.status],
    ['CLIENT_PAYMENT', order.payment_status === 'paid', order.payment_status],
    ['PURCHASING', purchasing, purchasing ? 'PO_LINKED' : 'PENDING'],
    ['SUPPLIER_EXECUTION', supplierPayment, supplierPayment ? 'PAYMENT_MATCHED' : 'PENDING'],
    ['FULFILLMENT', Boolean(fulfillment && fulfillment.tracking_number), fulfillment && fulfillment.tracking_number || 'PENDING'],
    ['HUB_INBOUND', inbound.verdict === 'INBOUND_MATCHED', inbound.verdict],
    ['CUSTOMS', customs, customs ? 'CUSTOMS_CLEARED' : 'PENDING'],
    ['RELAY_AVAILABLE', relayAvailable, relayAvailable ? 'AVAILABLE' : 'PENDING'],
    ['CUSTOMER_HANDOFF', handoff.verdict === 'HANDOFF_MATCHED', handoff.verdict],
    ['FINANCIAL_CLOSE', close.verdict === 'FINANCIAL_CLOSE_MATCHED', close.verdict],
  ];
  return {
    order: { id:order.id, reference:order.reference, status:order.status, payment_status:order.payment_status },
    steps: raw.map(([key, passed, evidence], i) => ({ index:i+1, key, passed:Boolean(passed), evidence })),
    verdict: close.verdict,
    observed_at: new Date().toISOString(),
    doctrine: 'read_only_projection_no_business_authority',
  };
}

module.exports = { projectGoldenEvidence };
