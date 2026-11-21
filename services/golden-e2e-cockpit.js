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
 * @db-read       purchase_lines, order_items, supplier_execution_payments, purchase_orders, supplier_execution_fulfillments, supplier_execution_orders, supplier_execution_order_lines, customs_shipment_parcels, parcels, parcel_items, customs_shipments
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

function evaluatePurchaseCoverage(rows) {
  if (!rows.length) return { purchasing: false, payment: false };
  const purchasing = rows.every(r => Number(r.ordered_qty) > 0
    && Number(r.purchased_qty) === Number(r.ordered_qty));
  const payment = purchasing && rows.every(r => Number(r.paid_qty) === Number(r.ordered_qty));
  return { purchasing, payment };
}

/**
 * A Hub allocation belongs to a purchase-line lineage, not necessarily to a
 * specific fulfillment. Two matched fulfillments sharing the same lineage
 * cannot both claim the same receipt as independent proof.
 * Fail closed until a persisted fulfillment-specific allocation exists.
 */
function evaluateInboundIndependence(results = []) {
  const lineOwners = new Map();
  const unitOwners = new Map();
  const conflicts = [];
  for (const row of results) {
    if (row?.verdict !== 'INBOUND_MATCHED') continue;
    const id = String(row.supplier_fulfillment_id || '');
    for (const [values, owners, kind] of [
      [row.purchase_line_ids, lineOwners, 'PURCHASE_LINE'],
      [row.hub_unit_refs, unitOwners, 'HUB_UNIT'],
    ]) {
      for (const value of new Set(Array.isArray(values) ? values : [])) {
        if (owners.has(value) && owners.get(value) !== id) {
          conflicts.push(`SHARED_${kind}:${value}`);
        } else owners.set(value, id);
      }
    }
  }
  return { independent: conflicts.length === 0, conflicts };
}

async function projectGoldenEvidence(db, order) {
  const orderId = order.id;
  // Chaque besoin client doit être couvert en quantité par des lignes d'achat actives.
  // Le paiement fournisseur doit être prouvé sur TOUS les PO concernés, pas seulement un.
  const purchaseResult = await db.query(`
    SELECT oi.id AS order_item_id, oi.quantity AS ordered_qty,
           COALESCE(SUM(pl.quantity) FILTER (
             WHERE pl.cancelled_at IS NULL AND pl.purchase_order_id IS NOT NULL
               AND oi.sku_id IS NOT NULL
               AND pl.product_sku_id = oi.sku_id
           ), 0) AS purchased_qty,
           COALESCE(SUM(pl.quantity) FILTER (
             WHERE pl.cancelled_at IS NULL AND pl.purchase_order_id IS NOT NULL
               AND oi.sku_id IS NOT NULL
               AND pl.product_sku_id = oi.sku_id
               AND EXISTS (
                 SELECT 1 FROM supplier_execution_payments sep
                  WHERE sep.purchase_order_id = pl.purchase_order_id
                    AND sep.status = 'succeeded'
                    AND sep.reconciliation_status = 'matched'
                    AND sep.real_debit_verified = TRUE
               )
           ), 0) AS paid_qty
      FROM order_items oi
      LEFT JOIN purchase_lines pl ON pl.order_item_id = oi.id
     WHERE oi.order_id = $1
     GROUP BY oi.id, oi.quantity
  `, [orderId]);
  const coverage = evaluatePurchaseCoverage(purchaseResult.rows || []);
  const purchasing = coverage.purchasing;
  const supplierPayment = coverage.payment;

  // Aucun LIMIT 1 : tous les fulfillments de toutes les lignes sont contrôlés.
  const fulfillmentResult = await db.query(`
    SELECT DISTINCT f.id, f.tracking_number, f.reconciliation_status,
           f.expected_quantity, f.observed_quantity
      FROM supplier_execution_fulfillments f
      JOIN supplier_execution_orders e ON e.id = f.supplier_execution_order_id
      JOIN supplier_execution_order_lines eol ON eol.supplier_execution_order_id = e.id
      JOIN purchase_lines pl ON pl.id = eol.purchase_line_id AND pl.cancelled_at IS NULL
      JOIN order_items oi ON oi.id = pl.order_item_id
     WHERE oi.order_id = $1
     ORDER BY f.id
  `, [orderId]);
  const fulfillments = fulfillmentResult.rows || [];
  const fulfillmentComplete = purchasing && fulfillments.length > 0
    && fulfillments.every(f => f.reconciliation_status === 'matched'
      && Boolean(f.tracking_number)
      && Number(f.expected_quantity) > 0
      && Number(f.observed_quantity) === Number(f.expected_quantity));
  const physical = evaluatePhysicalLines(await loadOrderLines(db, orderId));

  const inboundResults = await Promise.all(fulfillments.map(f =>
    reconcileHubInbound(db, { supplierFulfillmentId: f.id })
  ));
  const inboundIndependence = evaluateInboundIndependence(inboundResults);
  const inboundMatched = fulfillmentComplete && inboundResults.length === fulfillments.length
    && inboundResults.every(r => r.verdict === 'INBOUND_MATCHED')
    && inboundIndependence.independent;
  const inboundEvidence = !fulfillments.length ? 'SUPPLIER_FULFILLMENT_NOT_FOUND'
    : [...inboundResults.map((r, i) => `${fulfillments[i].id}:${r.verdict}`),
       ...inboundIndependence.conflicts.map(c => `NON_PROUVE:${c}`)].join(';');
  const handoff = await reconcileCustomerHandoff(db, { orderId });
  const close = await reconcileOrderFinancialClose(db, { orderId });

  const raw = [
    ['CLIENT_ORDER', true, order.status],
    ['CLIENT_PAYMENT', order.payment_status === 'paid', order.payment_status],
    ['PURCHASING', purchasing, purchasing ? 'ALL_LINES_PO_LINKED' : 'PENDING:PARTIAL_PURCHASING'],
    ['SUPPLIER_EXECUTION', supplierPayment, supplierPayment ? 'ALL_LINES_PAYMENT_MATCHED' : 'PENDING:PARTIAL_SUPPLIER_PAYMENT'],
    ['FULFILLMENT', fulfillmentComplete, fulfillmentComplete ? `${fulfillments.length} FULFILLMENTS_MATCHED` : 'PENDING:FULFILLMENT_COVERAGE'],
    ['HUB_INBOUND', inboundMatched, inboundEvidence],
    ['CUSTOMS', physical.customs.passed, physical.customs.evidence],
    ['RELAY_AVAILABLE', physical.relay.passed, physical.relay.evidence],
    ['CUSTOMER_HANDOFF', handoff.verdict === 'HANDOFF_MATCHED', handoff.verdict],
    ['FINANCIAL_CLOSE', close.verdict === 'FINANCIAL_CLOSE_MATCHED', close.verdict],
  ];
  return {
    order: { id:order.id, reference:order.reference, market_code:order.market_code || null, status:order.status, payment_status:order.payment_status },
    steps: raw.map(([key, passed, evidence], i) => ({ index:i+1, key, passed:Boolean(passed), evidence })),
    verdict: close.verdict,
    observed_at: new Date().toISOString(),
    doctrine: 'read_only_projection_no_business_authority',
  };
}

module.exports = { projectGoldenEvidence, evaluatePhysicalLines, evaluatePurchaseCoverage, evaluateInboundIndependence };
