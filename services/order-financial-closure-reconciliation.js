/**
 * @komerce-arch
 * @role          order-financial-closure-reconciliation
 * @domain        orders
 * @layer         service
 * @criticality   high
 * @inputs        customer order id
 * @outputs       read-only financial closure verdict across handoff/incidents/refunds/supplier-payments
 * @depends       services/customer-handoff-reconciliation.js, services/pricing-maturity.js
 * @used-by       future Order 360 / Control Tower / Golden closure
 * @db-read       orders, parcels, incidents, refunds, purchase_lines, order_items, supplier_execution_payments, order_item_real_cost_allocations, order_item_cost_imputations, customs_shipments, customs_shipment_parcels
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/chantier/CUSTOMER_TO_CUSTOMER_CLOSURE.md
 * @impact-areas  orders, logistics, refunds, incident-management, purchasing, payments
 */
'use strict';

const { reconcileCustomerHandoff } = require('./customer-handoff-reconciliation');
const { getOrderMaturity } = require('./pricing-maturity');

const VERDICT = Object.freeze({
  MATCHED: 'FINANCIAL_CLOSE_MATCHED',
  PENDING: 'FINANCIAL_CLOSE_PENDING',
  MISMATCH: 'FINANCIAL_CLOSE_MISMATCH',
});

function text(value) {
  const v = String(value || '').trim();
  return v || null;
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function loadOrder(client, orderId) {
  const id = text(orderId);
  if (!id) throw new Error('FINANCIAL_CLOSE_ORDER_ID_REQUIRED');

  const { rows } = await client.query(`
    SELECT id, reference, status::text AS status,
           payment_status::text AS payment_status,
           payment_mode::text AS payment_mode,
           total_kmf, total_eur
      FROM orders
     WHERE id = $1
  `, [id]);

  if (!rows[0]) throw new Error('FINANCIAL_CLOSE_ORDER_NOT_FOUND');
  return rows[0];
}

async function loadIncidents(client, orderId) {
  const { rows } = await client.query(`
    SELECT i.id, i.status, i.incident_type, i.resolution_type,
           i.resolution, i.parcel_id, i.order_item_id
      FROM incidents i
      LEFT JOIN parcels p ON p.id = i.parcel_id
     WHERE i.order_id = $1
        OR p.order_id = $1
     ORDER BY i.created_at, i.id
  `, [orderId]);
  return rows;
}

async function loadRefunds(client, orderId) {
  const { rows } = await client.query(`
    SELECT id, refund_type, refund_method, status,
           amount_kmf, amount_eur, completed_at,
           stripe_refund_id, store_credit_id
      FROM refunds
     WHERE order_id = $1
     ORDER BY created_at, id
  `, [orderId]);
  return rows;
}

async function loadSupplierPayments(client, orderId) {
  const { rows } = await client.query(`
    SELECT DISTINCT sep.id, sep.provider, sep.status,
           sep.reconciliation_status, sep.real_debit_verified,
           sep.expected_amount, sep.observed_amount, sep.currency
      FROM supplier_execution_payments sep
      JOIN purchase_lines pl
        ON pl.purchase_order_id = sep.purchase_order_id
       AND pl.cancelled_at IS NULL
      JOIN order_items oi
        ON oi.id = pl.order_item_id
     WHERE oi.order_id = $1
     ORDER BY sep.provider, sep.id
  `, [orderId]);
  return rows;
}

function supplierPaymentAssessment(rows) {
  if (!rows.length) return { state: 'none', blocking: [], pending: [] };

  const blocking = rows.filter(row =>
    row.status === 'rejected'
    || row.status === 'ambiguous'
    || row.reconciliation_status === 'mismatched'
  );

  const pending = rows.filter(row =>
    row.status === 'prepared'
    || row.status === 'requested'
    || row.reconciliation_status === 'pending'
    || row.reconciliation_status === 'unverified'
    || (row.status === 'succeeded'
      && row.reconciliation_status === 'matched'
      && row.real_debit_verified !== true)
  );

  if (blocking.length) return { state: 'mismatch', blocking, pending };
  if (pending.length) return { state: 'pending', blocking, pending };
  return { state: 'matched', blocking: [], pending: [] };
}

function refundAssessment(refunds) {
  const pending = refunds.filter(r => r.status !== 'completed');
  const completed = refunds.filter(r => r.status === 'completed');
  return { pending, completed };
}

function incidentAssessment(incidents) {
  const active = incidents.filter(i => ['open', 'investigating'].includes(i.status));
  const resolved = incidents.filter(i => ['resolved', 'dismissed'].includes(i.status));
  const refundResolved = resolved.filter(i => i.resolution_type === 'refund');
  const reshipResolved = resolved.filter(i => i.resolution_type === 'reship');
  return { active, resolved, refundResolved, reshipResolved };
}

function exposeSupplierPayments(rows) {
  return Object.freeze(rows.map(row => Object.freeze({
    id: row.id,
    provider: row.provider,
    status: row.status,
    reconciliation_status: row.reconciliation_status,
    real_debit_verified: row.real_debit_verified === true,
    expected_amount: asNumber(row.expected_amount),
    observed_amount: row.observed_amount == null ? null : asNumber(row.observed_amount),
    currency: row.currency,
  })));
}

function exposeRefunds(rows) {
  return Object.freeze(rows.map(row => Object.freeze({
    id: row.id,
    refund_type: row.refund_type,
    refund_method: row.refund_method,
    status: row.status,
    amount_kmf: asNumber(row.amount_kmf),
    amount_eur: row.amount_eur == null ? null : asNumber(row.amount_eur),
    completed_at: row.completed_at || null,
  })));
}

async function loadEconomicActuals(client, order) {
  const { rows } = await client.query(`
    SELECT COALESCE(SUM(amount_kmf), 0)::numeric AS real_cost_kmf
      FROM order_item_real_cost_allocations
     WHERE order_id = $1
       AND is_actual = TRUE
  `, [order.id]);

  const realCost = asNumber(rows[0]?.real_cost_kmf);
  const saleTotal = asNumber(order.total_kmf);

  return Object.freeze({
    sale_total_kmf: saleTotal,
    real_cost_kmf: realCost,
    consolidated_margin_kmf: saleTotal - realCost,
  });
}

function exposeIncidents(rows) {
  return Object.freeze(rows.map(row => Object.freeze({
    id: row.id,
    status: row.status,
    incident_type: row.incident_type,
    resolution_type: row.resolution_type || null,
  })));
}

function output({
  verdict,
  reason,
  mode,
  order,
  handoff,
  incidents,
  refunds,
  supplierPayments,
  economicMaturity,
  economicActuals = null,
} = {}) {
  return Object.freeze({
    scope: 'ORDER_FINANCIAL_CLOSE',
    verdict,
    reason,
    mode,
    order_id: order.id,
    order_reference: order.reference,
    order_status: order.status,
    payment_status: order.payment_status,
    handoff_verdict: handoff.verdict,
    incidents: exposeIncidents(incidents),
    refunds: exposeRefunds(refunds),
    supplier_payments: exposeSupplierPayments(supplierPayments),
    economic_maturity: economicMaturity
      ? Object.freeze({
        mature: economicMaturity.mature === true,
        maturity_status: economicMaturity.maturity_status || null,
        blocking_reasons: Object.freeze([...(economicMaturity.blocking_reasons || [])]),
      })
      : null,
    economic_actuals: economicActuals,
  });
}

async function reconcileOrderFinancialClose(client, { orderId } = {}) {
  if (!client || typeof client.query !== 'function') {
    throw new Error('FINANCIAL_CLOSE_DB_CLIENT_REQUIRED');
  }

  const order = await loadOrder(client, orderId);
  const [handoff, incidents, refunds, supplierPayments, economicMaturity] = await Promise.all([
    reconcileCustomerHandoff(client, { orderId: order.id }),
    loadIncidents(client, order.id),
    loadRefunds(client, order.id),
    loadSupplierPayments(client, order.id),
    getOrderMaturity(order.id, client),
  ]);

  const incident = incidentAssessment(incidents);
  const refund = refundAssessment(refunds);
  const supplier = supplierPaymentAssessment(supplierPayments);

  const base = {
    order,
    handoff,
    incidents,
    refunds,
    supplierPayments,
    economicMaturity,
  };

  if (incident.active.length > 0) {
    return output({
      ...base,
      verdict: VERDICT.PENDING,
      reason: 'FINANCIAL_CLOSE_ACTIVE_INCIDENT',
      mode: 'exception',
    });
  }

  if (refund.pending.length > 0) {
    return output({
      ...base,
      verdict: VERDICT.PENDING,
      reason: 'FINANCIAL_CLOSE_REFUND_PENDING',
      mode: 'exception',
    });
  }

  if (supplier.state === 'mismatch') {
    return output({
      ...base,
      verdict: VERDICT.MISMATCH,
      reason: 'FINANCIAL_CLOSE_SUPPLIER_PAYMENT_MISMATCH',
      mode: 'financial',
    });
  }

  if (supplier.state === 'pending') {
    return output({
      ...base,
      verdict: VERDICT.PENDING,
      reason: 'FINANCIAL_CLOSE_SUPPLIER_PAYMENT_PENDING',
      mode: 'financial',
    });
  }

  const refundedTerminal = order.status === 'refunded' || order.payment_status === 'refunded';
  const cancelledTerminal = order.status === 'cancelled';

  if (refundedTerminal) {
    if (refund.completed.length === 0) {
      return output({
        ...base,
        verdict: VERDICT.MISMATCH,
        reason: 'FINANCIAL_CLOSE_REFUND_FACT_MISSING',
        mode: 'refund',
      });
    }

    return output({
      ...base,
      verdict: VERDICT.MATCHED,
      reason: null,
      mode: 'refund',
    });
  }

  if (cancelledTerminal) {
    if (order.payment_status === 'paid' && refund.completed.length === 0) {
      return output({
        ...base,
        verdict: VERDICT.MISMATCH,
        reason: 'FINANCIAL_CLOSE_PAID_CANCEL_WITHOUT_REFUND',
        mode: 'cancel',
      });
    }

    return output({
      ...base,
      verdict: VERDICT.MATCHED,
      reason: null,
      mode: 'cancel',
    });
  }

  if (incident.refundResolved.length > 0 && refund.completed.length === 0) {
    return output({
      ...base,
      verdict: VERDICT.MISMATCH,
      reason: 'FINANCIAL_CLOSE_INCIDENT_REFUND_MISSING',
      mode: 'exception',
    });
  }

  if (handoff.verdict === 'HANDOFF_MISMATCH') {
    return output({
      ...base,
      verdict: VERDICT.MISMATCH,
      reason: 'FINANCIAL_CLOSE_HANDOFF_MISMATCH',
      mode: 'normal',
    });
  }

  if (handoff.verdict !== 'HANDOFF_MATCHED') {
    return output({
      ...base,
      verdict: VERDICT.PENDING,
      reason: 'FINANCIAL_CLOSE_HANDOFF_PENDING',
      mode: 'normal',
    });
  }

  if (order.status !== 'collected') {
    return output({
      ...base,
      verdict: VERDICT.MISMATCH,
      reason: 'FINANCIAL_CLOSE_ORDER_NOT_COLLECTED',
      mode: 'normal',
    });
  }

  if (order.payment_status !== 'paid') {
    return output({
      ...base,
      verdict: VERDICT.MISMATCH,
      reason: 'FINANCIAL_CLOSE_CUSTOMER_PAYMENT_NOT_PAID',
      mode: 'normal',
    });
  }

  if (!economicMaturity || economicMaturity.mature !== true) {
    return output({
      ...base,
      verdict: VERDICT.PENDING,
      reason: 'FINANCIAL_CLOSE_ECONOMIC_FACTS_PENDING',
      mode: 'financial',
    });
  }

  const economicActuals = await loadEconomicActuals(client, order);

  return output({
    ...base,
    verdict: VERDICT.MATCHED,
    reason: null,
    mode: incident.reshipResolved.length ? 'replacement' : 'normal',
    economicActuals,
  });
}

module.exports = {
  VERDICT,
  supplierPaymentAssessment,
  refundAssessment,
  incidentAssessment,
  loadEconomicActuals,
  reconcileOrderFinancialClose,
};
