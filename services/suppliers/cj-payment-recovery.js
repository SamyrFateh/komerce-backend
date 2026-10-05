/**
 * @komerce-arch
 * @role          cj-payment-recovery
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        CJ order read-back facts for an ambiguous supplier payment
 * @outputs       conservative canonical recovery verdict
 * @depends       services/suppliers/cj-purchasing-contract.js, services/supplier-payment-state.js
 * @used-by       future CJ provider payment orchestrator
 * @db-read       supplier_execution_payments
 * @db-write      supplier_execution_payments, supplier_execution_events
 * @db-txn        caller_owned_transaction
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_PAYMENT_FACT.md, docs/external-providers/suppliers/CJ_PURCHASING_CONTRACT.md
 * @impact-areas  purchasing, supplier-integration
 * @version       2026-10
 */
'use strict';

const contract = require('./cj-purchasing-contract');
const {
  loadByKey,
  markPaymentSucceeded,
} = require('../supplier-payment-state');

const PAID_STATUSES = new Set(['PENDING', 'PROCESSING', 'UNSHIPPED', 'SHIPPED', 'DELIVERED']);
const UNPAID_STATUSES = new Set(['CREATED', 'IN_CART', 'UNPAID']);

function classifyCjPaymentReadback(details = []) {
  if (!Array.isArray(details) || details.length < 1) {
    return { verdict: 'unknown', reason: 'NO_READBACK' };
  }

  const statuses = details.map((body) => {
    const facts = contract.readOrderDetailFacts(body);
    return String(facts.status || '').trim().toUpperCase();
  });

  if (statuses.every(status => PAID_STATUSES.has(status))) {
    return { verdict: 'paid_confirmed', statuses };
  }

  if (statuses.every(status => UNPAID_STATUSES.has(status))) {
    return {
      verdict: 'unpaid_observed',
      statuses,
      retry_authorized: false,
      reason: 'OBSERVATION_DOES_NOT_PROVE_SAFE_RETRY',
    };
  }

  return {
    verdict: 'unknown',
    statuses,
    retry_authorized: false,
    reason: 'MIXED_OR_UNKNOWN_PROVIDER_STATE',
  };
}

async function recoverAmbiguousCjPayment(client, {
  paymentExecutionKey,
  details,
  observedAmount,
  paymentRef = null,
} = {}) {
  const payment = await loadByKey(client, 'cj', paymentExecutionKey, true);
  if (!payment) throw new Error('SUPPLIER_PAYMENT_NOT_FOUND');
  if (payment.status !== 'ambiguous') {
    throw new Error(`CJ_PAYMENT_RECOVERY_REQUIRES_AMBIGUOUS:${payment.status}`);
  }

  const recovery = classifyCjPaymentReadback(details);

  if (recovery.verdict !== 'paid_confirmed') {
    return {
      resolved: false,
      retry_authorized: false,
      payment,
      recovery,
    };
  }

  const expected = Number(payment.expected_amount);
  const observed = Number(observedAmount);
  if (!Number.isFinite(observed) || observed <= 0) {
    throw new Error('CJ_PAYMENT_RECOVERY_OBSERVED_AMOUNT_REQUIRED');
  }
  if (observed !== expected) {
    return {
      resolved: false,
      retry_authorized: false,
      payment,
      recovery: {
        ...recovery,
        verdict: 'amount_mismatch',
        expected_amount: expected,
        observed_amount: observed,
      },
    };
  }

  const updated = await markPaymentSucceeded(client, {
    provider: 'cj',
    paymentExecutionKey,
    observedAmount: observed,
    reconciliationStatus: 'matched',
    paymentRef,
    realDebitVerified: false,
  });

  return {
    resolved: true,
    retry_authorized: false,
    payment: updated,
    recovery: {
      ...recovery,
      amount_verdict: 'matched',
      real_debit_verified: false,
    },
  };
}

module.exports = {
  PAID_STATUSES,
  UNPAID_STATUSES,
  classifyCjPaymentReadback,
  recoverAmbiguousCjPayment,
};
