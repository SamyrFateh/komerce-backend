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
 * @db-read       purchase_lines, order_items, supplier_execution_payments, purchase_orders, supplier_execution_fulfillments, supplier_execution_orders, customs_shipment_parcels, parcels, parcel_items, customs_shipments
 * @db-write      none
 * @db-txn        none
 * @doctrine      projection_only_no_business_authority, hub_organizes_parcels_freely, proof_by_units_not_by_parcels
 * @impact-areas  dashboard, e2e-certification
 * @version       2026-10
 */

'use strict';

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

/**
 * Le Hub organise librement ses colis : un colis peut regrouper plusieurs commandes, une commande peut être
 * répartie sur plusieurs colis. La preuve physique repose donc sur les LIGNES (order_items ↔ parcel_items) et
 * leurs quantités, jamais sur parcels.order_id. Un colis annulé n'est pas une ligne vivante (réaffectation).
 */
async function loadOrderLines(db, orderId) {
  const result = await db.query(
    `SELECT oi.id AS order_item_id, oi.quantity AS ordered_qty,
            pi.parcel_id, pi.quantity AS line_qty, pi.qty_received, pi.qty_collected,
            p.reference AS parcel_ref, p.status::text AS parcel_status,
            (p.customs_cleared_at IS NOT NULL AND EXISTS (
               SELECT 1 FROM customs_shipment_parcels csp
                 JOIN customs_shipments cs ON cs.id = csp.shipment_id
                WHERE csp.parcel_id = p.id AND cs.status IN ('declared','confirmed'))) AS customs_ok
       FROM order_items oi
       LEFT JOIN parcel_items pi ON pi.order_item_id = oi.id
       LEFT JOIN parcels p ON p.id = pi.parcel_id AND p.status::text <> 'cancelled'
      WHERE oi.order_id = $1
      ORDER BY oi.id, p.created_at, pi.parcel_id`,
    [orderId]
  );
  return result.rows || [];
}

const AT_RELAY = new Set(['available', 'collected']);
const num = (v) => Number(v || 0);

function evaluatePhysicalLines(rows) {
  const items = new Map();
  for (const r of rows) {
    if (!items.has(r.order_item_id)) items.set(r.order_item_id, { ordered: num(r.ordered_qty), lines: [] });
    if (r.parcel_id && r.parcel_status) items.get(r.order_item_id).lines.push(r); // colis annulé ou absent : pas de ligne vivante
  }
  const reasons = [];
  if (!items.size) reasons.push('NO_ORDER_ITEMS');
  const live = [];
  for (const [, item] of items) {
    const allocated = item.lines.reduce((n, l) => n + num(l.line_qty), 0);
    if (allocated < item.ordered) reasons.push('QUANTITY_NOT_FULLY_ALLOCATED');
    if (allocated > item.ordered) reasons.push('QUANTITY_OVER_ALLOCATED');
    live.push(...item.lines);
  }
  const parcels = new Set(live.map((l) => l.parcel_id));
  const units = live.reduce((n, l) => n + num(l.line_qty), 0);
  const scope = `${parcels.size} colis · ${units} unité(s)`;

  // Télémétrie de quantités (scan engine) : si elle existe elle doit être cohérente avec la ligne.
  const incoherent = live.some((l) => num(l.qty_received) > num(l.line_qty) || num(l.qty_collected) > num(l.line_qty)
    || (num(l.qty_collected) > num(l.qty_received) && num(l.qty_received) > 0));
  if (incoherent) reasons.push('QUANTITY_TELEMETRY_INCONSISTENT');
  const partialReceived = live.some((l) => AT_RELAY.has(l.parcel_status) && num(l.qty_received) > 0 && num(l.qty_received) < num(l.line_qty));
  if (partialReceived) reasons.push('QUANTITY_PARTIALLY_RECEIVED');

  // Rien n'est encore alloué à un colis vivant : simple attente (PENDING), pas une preuve contredite.
  const unprovable = reasons.length > 0 && (live.length > 0 || reasons.includes('NO_ORDER_ITEMS'));
  const fail = (what) => ({ passed: false, evidence: unprovable ? `NON_PROUVE:${[...new Set(reasons)].join(',')}` : what });

  const customsDone = live.filter((l) => l.customs_ok).length;
  const customs = !unprovable && live.length && customsDone === live.length
    ? { passed: true, evidence: `CUSTOMS_CLEARED · ${scope}` }
    : fail(live.length && customsDone ? `PENDING:CUSTOMS_PARTIAL ${customsDone}/${live.length} lignes` : 'PENDING');

  const atRelay = live.filter((l) => AT_RELAY.has(l.parcel_status)).length;
  const relay = !unprovable && live.length && atRelay === live.length
    ? { passed: true, evidence: `AVAILABLE · ${scope}` }
    : fail(live.length && atRelay ? `PENDING:RELAY_PARTIAL ${atRelay}/${live.length} lignes` : 'PENDING');

  return { customs, relay };
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
  const physical = evaluatePhysicalLines(await loadOrderLines(db, orderId));

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
    ['CUSTOMS', physical.customs.passed, physical.customs.evidence],
    ['RELAY_AVAILABLE', physical.relay.passed, physical.relay.evidence],
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

module.exports = { projectGoldenEvidence, evaluatePhysicalLines };
