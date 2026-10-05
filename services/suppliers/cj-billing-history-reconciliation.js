/**
 * @komerce-arch
 * @role          cj-billing-history-reconciliation
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        persisted supplier payment + CJ billingHistory reader
 * @outputs       verified and persisted real-debit proof
 * @depends       services/suppliers/cj-purchasing-contract.js, services/supplier-real-debit-verification.js, services/supplier-payment-proof-persistence.js
 * @used-by       future CJ payment reconciliation runtime
 * @db-read       supplier_execution_payments, supplier_execution_groups, supplier_execution_group_members, supplier_execution_orders
 * @db-write      supplier_execution_payment_proofs, supplier_execution_payments, supplier_execution_events
 * @db-txn        caller_owned_transaction
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_PAYMENT_FACT.md
 * @impact-areas  purchasing, supplier-integration
 * @version       2026-10
 */
'use strict';

const contract = require('./cj-purchasing-contract');
const { verifyRealDebitEvidence } = require('../supplier-real-debit-verification');
const { persistSupplierPaymentProof } = require('../supplier-payment-proof-persistence');

async function loadPaymentContext(client, paymentId) {
  const { rows } = await client.query(`
    SELECT p.*,
           g.supplier_parent_order_id
      FROM supplier_execution_payments p
      LEFT JOIN supplier_execution_groups g
        ON g.id = p.supplier_execution_group_id
     WHERE p.id = $1
     FOR UPDATE
  `, [paymentId]);
  const payment = rows[0];
  if (!payment) throw new Error('SUPPLIER_PAYMENT_NOT_FOUND');
  if (payment.provider !== 'cj') throw new Error('CJ_PAYMENT_PROVIDER_MISMATCH');
  return { payment };
}

async function loadPaymentOrderIds(client, payment) {
  let orderIds = [];
  if (payment.supplier_execution_group_id) {
    const result = await client.query(`
      SELECT o.supplier_order_id
        FROM supplier_execution_group_members gm
        JOIN supplier_execution_orders o
          ON o.id = gm.supplier_execution_order_id
       WHERE gm.supplier_execution_group_id = $1
       ORDER BY o.supplier_order_id
    `, [payment.supplier_execution_group_id]);
    orderIds = result.rows.map(r => String(r.supplier_order_id));
  } else if (payment.supplier_execution_order_id) {
    const result = await client.query(`
      SELECT supplier_order_id
        FROM supplier_execution_orders
       WHERE id = $1
    `, [payment.supplier_execution_order_id]);
    orderIds = result.rows.map(r => String(r.supplier_order_id));
  }

  if (!orderIds.length) throw new Error('CJ_PAYMENT_ORDER_IDS_MISSING');
  return orderIds;
}

async function reconcileCjBillingHistory(client, {
  supplierPaymentId,
  fetchBillingHistory,
} = {}) {
  if (typeof fetchBillingHistory !== 'function') {
    throw new Error('CJ_BILLING_HISTORY_READER_REQUIRED');
  }

  const { payment } = await loadPaymentContext(client, supplierPaymentId);

  if (payment.status !== 'succeeded' || payment.reconciliation_status !== 'matched') {
    throw new Error('CJ_BILLING_RECONCILIATION_PAYMENT_NOT_READY');
  }
  if (payment.real_debit_verified === true) {
    return {
      verified: true,
      already_verified: true,
      payment,
      proof: null,
    };
  }

  const orderIds = await loadPaymentOrderIds(client, payment);

  const responses = [];
  for (const orderId of orderIds) {
    const body = await fetchBillingHistory(
      contract.buildBillingHistoryQuery({ orderId })
    );
    responses.push(body);
  }

  const merged = {
    result: responses.every(x => x?.result === true),
    data: {
      list: responses.flatMap(x => Array.isArray(x?.data?.list) ? x.data.list : []),
    },
  };

  const parsed = contract.parseBillingHistoryDebitEvidence(merged, {
    expectedOrderIds: orderIds,
    expectedAmount: Number(payment.expected_amount),
  });

  if (!parsed.verified) {
    return {
      verified: false,
      already_verified: false,
      reason: parsed.reason,
      payment,
      proof: null,
    };
  }

  const candidate = {
    ...parsed.evidence,
    payment_ref: parsed.evidence.payment_ref || payment.payment_ref || null,
  };

  const verification = verifyRealDebitEvidence(payment, candidate);
  if (!verification.verified) {
    return {
      verified: false,
      already_verified: false,
      reason: 'CJ_BILLING_DEBIT_EVIDENCE_REJECTED',
      verification,
      payment,
      proof: null,
    };
  }

  const proof = await persistSupplierPaymentProof(client, {
    supplierPaymentId: payment.id,
    provider: verification.normalized.provider,
    proofSource: verification.normalized.proof_source,
    proofRef: verification.normalized.proof_ref,
    providerOrderId: candidate.provider_order_id,
    paymentRef: verification.normalized.payment_ref,
    observedAmount: verification.normalized.observed_amount,
    currency: verification.normalized.currency,
    debitConfirmed: true,
    sandbox: false,
    simulated: false,
    occurredAt: candidate.occurred_at,
    providerFacts: {
      payment_type: candidate.payment_type,
      status: candidate.status,
      after_transaction_amount: candidate.after_transaction_amount,
    },
  });

  return {
    verified: true,
    already_verified: false,
    payment_id: payment.id,
    proof,
    evidence: verification.normalized,
  };
}

module.exports = {
  loadPaymentContext,
  loadPaymentOrderIds,
  reconcileCjBillingHistory,
};
