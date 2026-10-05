/**
 * @komerce-arch
 * @role          supplier-payment-state
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        canonical supplier payment facts
 * @outputs       persisted payment lifecycle with replay safety
 * @depends       none
 * @used-by       future provider payment orchestration
 * @db-read       supplier_execution_payments
 * @db-write      supplier_execution_payments, supplier_execution_events
 * @db-txn        caller_owned_transaction
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_PAYMENT_FACT.md
 * @impact-areas  purchasing, supplier-integration
 * @version       2026-10
 */
'use strict';

function text(value) {
  const v = String(value || '').trim();
  return v || null;
}

function money(value, code) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(code);
  return n;
}

async function loadByKey(client, provider, paymentExecutionKey, lock = false) {
  const p = text(provider)?.toLowerCase();
  const key = text(paymentExecutionKey);
  if (!p) throw new Error('SUPPLIER_PAYMENT_PROVIDER_REQUIRED');
  if (!key) throw new Error('SUPPLIER_PAYMENT_EXECUTION_KEY_REQUIRED');

  const { rows } = await client.query(`
    SELECT *
      FROM supplier_execution_payments
     WHERE provider = $1 AND payment_execution_key = $2
     ${lock ? 'FOR UPDATE' : ''}
  `, [p, key]);
  return rows[0] || null;
}

async function prepareSupplierPayment(client, {
  purchaseOrderId,
  provider,
  paymentExecutionKey,
  supplierExecutionOrderId = null,
  supplierExecutionGroupId = null,
  expectedAmount,
  currency,
  paymentRef = null,
} = {}) {
  const po = text(purchaseOrderId);
  const p = text(provider)?.toLowerCase();
  const key = text(paymentExecutionKey);
  const ccy = text(currency)?.toUpperCase();
  const amount = money(expectedAmount, 'SUPPLIER_PAYMENT_EXPECTED_AMOUNT_INVALID');
  if (!po) throw new Error('PURCHASE_ORDER_ID_REQUIRED');
  if (!p) throw new Error('SUPPLIER_PAYMENT_PROVIDER_REQUIRED');
  if (!key) throw new Error('SUPPLIER_PAYMENT_EXECUTION_KEY_REQUIRED');
  if (!ccy || !/^[A-Z]{3}$/.test(ccy)) throw new Error('SUPPLIER_PAYMENT_CURRENCY_INVALID');

  const existing = await loadByKey(client, p, key, true);
  if (existing) {
    if (
      String(existing.purchase_order_id) !== po ||
      Number(existing.expected_amount) !== amount ||
      String(existing.currency) !== ccy ||
      String(existing.supplier_execution_order_id || '') !== String(supplierExecutionOrderId || '') ||
      String(existing.supplier_execution_group_id || '') !== String(supplierExecutionGroupId || '')
    ) {
      throw new Error('SUPPLIER_PAYMENT_EXECUTION_REBIND_REFUSED');
    }
    return existing;
  }

  const { rows } = await client.query(`
    INSERT INTO supplier_execution_payments
      (purchase_order_id, provider, payment_execution_key,
       supplier_execution_order_id, supplier_execution_group_id,
       payment_ref, expected_amount, currency)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING *
  `, [
    po, p, key, text(supplierExecutionOrderId), text(supplierExecutionGroupId),
    text(paymentRef), amount, ccy,
  ]);
  return rows[0];
}

async function transition(client, {
  provider,
  paymentExecutionKey,
  fromStatuses,
  toStatus,
  observedAmount = null,
  reconciliationStatus = null,
  paymentRef = null,
  realDebitVerified = false,
  eventOutcome,
} = {}) {
  const current = await loadByKey(client, provider, paymentExecutionKey, true);
  if (!current) throw new Error('SUPPLIER_PAYMENT_NOT_FOUND');

  if (!fromStatuses.includes(current.status)) {
    throw new Error(`SUPPLIER_PAYMENT_TRANSITION_REFUSED:${current.status}->${toStatus}`);
  }

  const observed = observedAmount == null
    ? null
    : money(observedAmount, 'SUPPLIER_PAYMENT_OBSERVED_AMOUNT_INVALID');

  const reconciliation = reconciliationStatus || current.reconciliation_status;

  const { rows } = await client.query(`
    UPDATE supplier_execution_payments
       SET status = $1,
           observed_amount = COALESCE($2, observed_amount),
           reconciliation_status = $3,
           payment_ref = COALESCE($4, payment_ref),
           real_debit_verified = $5,
           updated_at = NOW()
     WHERE id = $6
     RETURNING *
  `, [
    toStatus,
    observed,
    reconciliation,
    text(paymentRef),
    realDebitVerified === true,
    current.id,
  ]);

  await client.query(`
    INSERT INTO supplier_execution_events
      (purchase_order_id, provider, supplier_execution_order_id,
       supplier_execution_group_id, operation, outcome, facts)
    VALUES ($1,$2,$3,$4,'provider_payment',$5,$6::jsonb)
  `, [
    current.purchase_order_id,
    current.provider,
    current.supplier_execution_order_id,
    current.supplier_execution_group_id,
    eventOutcome,
    JSON.stringify({
      payment_execution_key: current.payment_execution_key,
      status: toStatus,
      reconciliation_status: reconciliation,
      real_debit_verified: realDebitVerified === true,
    }),
  ]);

  return rows[0];
}

function markPaymentRequested(client, input) {
  return transition(client, {
    ...input,
    fromStatuses: ['prepared'],
    toStatus: 'requested',
    eventOutcome: 'requested',
  });
}

function markPaymentAmbiguous(client, input) {
  return transition(client, {
    ...input,
    fromStatuses: ['requested'],
    toStatus: 'ambiguous',
    reconciliationStatus: 'unverified',
    realDebitVerified: false,
    eventOutcome: 'ambiguous',
  });
}

function markPaymentSucceeded(client, input) {
  return transition(client, {
    ...input,
    fromStatuses: ['requested', 'ambiguous'],
    toStatus: 'succeeded',
    reconciliationStatus: input.reconciliationStatus || 'matched',
    eventOutcome: 'succeeded',
  });
}

function markPaymentRejected(client, input) {
  return transition(client, {
    ...input,
    fromStatuses: ['requested'],
    toStatus: 'rejected',
    reconciliationStatus: 'unverified',
    realDebitVerified: false,
    eventOutcome: 'rejected',
  });
}

async function canInvokeProviderPayment(client, { provider, paymentExecutionKey } = {}) {
  const row = await loadByKey(client, provider, paymentExecutionKey, false);
  if (!row) return { allowed: false, reason: 'PAYMENT_FACT_NOT_FOUND' };
  if (row.status === 'prepared') return { allowed: true, reason: 'READY_TO_REQUEST', payment: row };
  if (row.status === 'requested') return { allowed: false, reason: 'PAYMENT_REQUEST_IN_FLIGHT', payment: row };
  if (row.status === 'ambiguous') return { allowed: false, reason: 'PAYMENT_AMBIGUOUS_RECONCILIATION_REQUIRED', payment: row };
  if (row.status === 'succeeded') return { allowed: false, reason: 'PAYMENT_ALREADY_SUCCEEDED', payment: row };
  if (row.status === 'rejected') return { allowed: false, reason: 'PAYMENT_REJECTED_REVIEW_REQUIRED', payment: row };
  return { allowed: false, reason: 'PAYMENT_STATUS_UNKNOWN', payment: row };
}

module.exports = {
  loadByKey,
  prepareSupplierPayment,
  markPaymentRequested,
  markPaymentAmbiguous,
  markPaymentSucceeded,
  markPaymentRejected,
  canInvokeProviderPayment,
};
