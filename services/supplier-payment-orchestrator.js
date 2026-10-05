/**
 * @komerce-arch
 * @role          supplier-payment-orchestrator
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        canonical payment fact + injected provider payment operation
 * @outputs       replay-safe supplier payment lifecycle result
 * @depends       services/supplier-payment-state.js
 * @used-by       future provider payment adapters
 * @db-read       supplier_execution_payments
 * @db-write      supplier_execution_payments, supplier_execution_events
 * @db-txn        caller_owned_transaction
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_PAYMENT_FACT.md
 * @impact-areas  purchasing, supplier-integration
 * @version       2026-10
 */
'use strict';

const {
  prepareSupplierPayment,
  canInvokeProviderPayment,
  markPaymentRequested,
  markPaymentAmbiguous,
  markPaymentSucceeded,
  markPaymentRejected,
} = require('./supplier-payment-state');

function boundedMessage(error) {
  const raw = String(error?.message || error || 'provider_payment_error').trim();
  return raw.slice(0, 300);
}

async function executeSupplierPayment(client, {
  payment,
  invokeProviderPayment,
  classifyProviderError = () => 'ambiguous',
} = {}) {
  if (!payment || typeof payment !== 'object') throw new Error('SUPPLIER_PAYMENT_INPUT_REQUIRED');
  if (typeof invokeProviderPayment !== 'function') throw new Error('SUPPLIER_PAYMENT_PROVIDER_CALL_REQUIRED');

  const prepared = await prepareSupplierPayment(client, payment);
  const gate = await canInvokeProviderPayment(client, {
    provider: prepared.provider,
    paymentExecutionKey: prepared.payment_execution_key,
  });

  if (!gate.allowed) {
    return {
      invoked: false,
      reason: gate.reason,
      payment: gate.payment || prepared,
    };
  }

  await markPaymentRequested(client, {
    provider: prepared.provider,
    paymentExecutionKey: prepared.payment_execution_key,
  });

  let providerResult;
  try {
    providerResult = await invokeProviderPayment({
      payment_execution_key: prepared.payment_execution_key,
      payment_ref: prepared.payment_ref || null,
      expected_amount: Number(prepared.expected_amount),
      currency: prepared.currency,
    });
  } catch (error) {
    const classification = classifyProviderError(error);
    if (classification === 'rejected') {
      const rejected = await markPaymentRejected(client, {
        provider: prepared.provider,
        paymentExecutionKey: prepared.payment_execution_key,
      });
      return {
        invoked: true,
        outcome: 'rejected',
        payment: rejected,
        provider_error: boundedMessage(error),
      };
    }

    const ambiguous = await markPaymentAmbiguous(client, {
      provider: prepared.provider,
      paymentExecutionKey: prepared.payment_execution_key,
    });
    return {
      invoked: true,
      outcome: 'ambiguous',
      payment: ambiguous,
      provider_error: boundedMessage(error),
    };
  }

  if (!providerResult || providerResult.verdict !== 'succeeded') {
    const ambiguous = await markPaymentAmbiguous(client, {
      provider: prepared.provider,
      paymentExecutionKey: prepared.payment_execution_key,
    });
    return {
      invoked: true,
      outcome: 'ambiguous',
      payment: ambiguous,
      provider_result: providerResult || null,
    };
  }

  const succeeded = await markPaymentSucceeded(client, {
    provider: prepared.provider,
    paymentExecutionKey: prepared.payment_execution_key,
    observedAmount: providerResult.observed_amount,
    reconciliationStatus: providerResult.reconciliation_status || 'matched',
    paymentRef: providerResult.payment_ref || prepared.payment_ref || null,
    realDebitVerified: providerResult.real_debit_verified === true,
  });

  return {
    invoked: true,
    outcome: 'succeeded',
    payment: succeeded,
    provider_result: providerResult,
  };
}

module.exports = { executeSupplierPayment };
