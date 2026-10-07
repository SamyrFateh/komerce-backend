/**
 * @komerce-arch
 * @role          cj-supplier-payment-runtime
 * @domain        purchasing
 * @layer         service
 * @criticality   critical
 * @inputs        persisted CJ supplier payment id + explicit operator authorization
 * @outputs       replay-safe provider payment execution + billingHistory real-debit proof
 * @depends       services/supplier-payment-orchestrator.js, services/suppliers/cj-billing-history-reconciliation.js, services/suppliers/cj-fulfillment-adapter.js, services/suppliers/cj-purchasing-contract.js, services/suppliers/connectors/cj-connector.js, services/suppliers/provider-capability-certifications.js
 * @used-by       bounded operator flow / future admin action
 * @db-read       supplier_execution_payments, supplier_execution_orders, supplier_execution_groups
 * @db-write      supplier_execution_payments, supplier_execution_payment_proofs, supplier_execution_events
 * @db-txn        caller_owned_transaction
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_PAYMENT_FACT.md
 * @impact-areas  purchasing, supplier-integration, economic-engine
 */
'use strict';

const { executeSupplierPayment } = require('../supplier-payment-orchestrator');
const { reconcileCjBillingHistory } = require('./cj-billing-history-reconciliation');
const adapter = require('./cj-fulfillment-adapter');
const contract = require('./cj-purchasing-contract');
const connector = require('./connectors/cj-connector');
const { evaluateRuntimeCapability } = require('./provider-capability-certifications');

const ABSOLUTE_MAX_USD = 20;

function text(value) {
  const v = String(value || '').trim();
  return v || null;
}

function guardAuthorization(context = {}, payment) {
  const env = context.env || process.env;
  const certification = evaluateRuntimeCapability('cj', 'purchasing.real_debit', {
    runtime_environment: env.KOMERCE_PROVIDER_EXECUTION_ENV,
    ...(context.certification_registry ? { registry: context.certification_registry } : {}),
  });
  if (!certification.allowed) {
    const error = new Error(certification.reason);
    error.certification = certification;
    throw error;
  }

  const authorized = context.operator_authorized === true
    && env.KOMERCE_ALLOW_CJ_REAL_PAYMENT === '1';

  if (!authorized) throw new Error('CJ_REAL_PAYMENT_NOT_AUTHORIZED');
  if (env.KOMERCE_CJ_SANDBOX === '1') throw new Error('CJ_REAL_PAYMENT_SANDBOX_FORBIDDEN');

  const configuredCap = Number(env.KOMERCE_CJ_REAL_MAX_USD);
  if (!Number.isFinite(configuredCap) || configuredCap <= 0 || configuredCap > ABSOLUTE_MAX_USD) {
    throw new Error('CJ_REAL_MAX_USD_INVALID');
  }

  const amount = Number(payment.expected_amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('CJ_REAL_PAYMENT_AMOUNT_INVALID');
  if (String(payment.currency || '').toUpperCase() !== 'USD') throw new Error('CJ_REAL_PAYMENT_CURRENCY_UNSUPPORTED');
  if (amount > configuredCap) throw new Error('CJ_REAL_DEBIT_CAP_EXCEEDED');

  return { cap: configuredCap, amount };
}

async function loadPayment(client, supplierPaymentId) {
  const id = text(supplierPaymentId);
  if (!id) throw new Error('SUPPLIER_PAYMENT_ID_REQUIRED');

  const { rows } = await client.query(`
    SELECT p.*,
           o.supplier_order_id,
           g.supplier_parent_order_id
      FROM supplier_execution_payments p
      LEFT JOIN supplier_execution_orders o
        ON o.id = p.supplier_execution_order_id
      LEFT JOIN supplier_execution_groups g
        ON g.id = p.supplier_execution_group_id
     WHERE p.id = $1
  `, [id]);

  const payment = rows[0];
  if (!payment) throw new Error('SUPPLIER_PAYMENT_NOT_FOUND');
  if (String(payment.provider).toLowerCase() !== 'cj') throw new Error('CJ_PAYMENT_PROVIDER_MISMATCH');
  return payment;
}

async function fetchOrderFacts(orderId, { accessToken, call, fetchImpl }) {
  const body = await call(contract.ENDPOINTS.get_order_detail, {
    method: 'GET',
    query: contract.buildOrderDetailQuery(orderId),
    accessToken,
    fetchImpl,
  });
  return {
    body,
    facts: contract.readOrderDetailFacts(body),
  };
}

async function resolveShipmentOrderId(payment, context = {}) {
  if (payment.supplier_parent_order_id) {
    return text(payment.supplier_parent_order_id);
  }

  const orderId = text(payment.supplier_order_id);
  if (!orderId) throw new Error('CJ_PAYMENT_ORDER_ID_MISSING');

  const env = context.env || process.env;
  const accessToken = await connector.getAccessToken({
    env,
    ...(context.credentials ? { credentials: context.credentials } : {}),
  });
  const call = context.invoke || adapter._invoke;

  let read = await fetchOrderFacts(orderId, {
    accessToken,
    call,
    fetchImpl: context.fetchImpl,
  });

  if (read.facts.is_sandbox === true) throw new Error('CJ_REAL_PAYMENT_SANDBOX_ORDER_FORBIDDEN');

  let shipmentOrderId = text(read.facts.shipment_order_id);
  if (!shipmentOrderId) {
    const confirmBody = await call(contract.ENDPOINTS.confirm_order, {
      method: 'POST',
      body: contract.buildConfirmOrderPayload(orderId),
      accessToken,
      fetchImpl: context.fetchImpl,
    });
    contract.parseConfirmOrderResponse(confirmBody, orderId);

    read = await fetchOrderFacts(orderId, {
      accessToken,
      call,
      fetchImpl: context.fetchImpl,
    });
    shipmentOrderId = text(read.facts.shipment_order_id);
  }

  if (!shipmentOrderId) throw new Error('CJ_REAL_SHIPMENT_ORDER_ID_MISSING');
  return shipmentOrderId;
}

async function invokeRealPayment(payment, context = {}) {
  const { amount } = guardAuthorization(context, payment);
  const env = context.env || process.env;
  const accessToken = await connector.getAccessToken({
    env,
    ...(context.credentials ? { credentials: context.credentials } : {}),
  });
  const call = context.invoke || adapter._invoke;

  const shipmentOrderId = await resolveShipmentOrderId(payment, {
    ...context,
    env,
    invoke: call,
  });

  const payBody = await call(contract.ENDPOINTS.pay_balance_v2, {
    method: 'POST',
    body: contract.buildPayBalanceV2Payload(shipmentOrderId),
    accessToken,
    fetchImpl: context.fetchImpl,
  });
  contract.parsePayBalanceV2Response(payBody);

  return {
    verdict: 'succeeded',
    observed_amount: amount,
    reconciliation_status: 'matched',
    payment_ref: shipmentOrderId,
    real_debit_verified: false,
  };
}

async function fetchBillingHistoryFactory(context = {}) {
  const env = context.env || process.env;
  const accessToken = await connector.getAccessToken({
    env,
    ...(context.credentials ? { credentials: context.credentials } : {}),
  });
  const call = context.invoke || adapter._invoke;

  return async (query) => call(contract.ENDPOINTS.billing_history, {
    method: 'POST',
    body: query,
    accessToken,
    fetchImpl: context.fetchImpl,
  });
}

async function closeCjSupplierPayment(client, {
  supplierPaymentId,
  context = {},
} = {}) {
  let payment = await loadPayment(client, supplierPaymentId);

  if (payment.real_debit_verified === true) {
    return {
      invoked: false,
      already_verified: true,
      payment,
      proof: null,
    };
  }

  if (payment.status === 'prepared') {
    guardAuthorization(context, payment);

    const execution = await executeSupplierPayment(client, {
      payment: {
        purchaseOrderId: payment.purchase_order_id,
        provider: 'cj',
        paymentExecutionKey: payment.payment_execution_key,
        supplierExecutionOrderId: payment.supplier_execution_order_id,
        supplierExecutionGroupId: payment.supplier_execution_group_id,
        expectedAmount: Number(payment.expected_amount),
        currency: payment.currency,
        paymentRef: payment.payment_ref,
      },
      invokeProviderPayment: () => invokeRealPayment(payment, context),
    });

    if (execution.outcome !== 'succeeded') {
      return {
        invoked: execution.invoked === true,
        closed: false,
        execution,
      };
    }

    payment = execution.payment;
  } else if (!(payment.status === 'succeeded' && payment.reconciliation_status === 'matched')) {
    return {
      invoked: false,
      closed: false,
      reason: 'CJ_PAYMENT_REQUIRES_REVIEW',
      payment,
    };
  }

  const fetchBillingHistory = await fetchBillingHistoryFactory(context);
  const reconciliation = await reconcileCjBillingHistory(client, {
    supplierPaymentId: payment.id,
    fetchBillingHistory,
  });

  return {
    invoked: payment.status === 'succeeded',
    closed: reconciliation.verified === true,
    payment_id: payment.id,
    reconciliation,
  };
}

module.exports = {
  ABSOLUTE_MAX_USD,
  guardAuthorization,
  loadPayment,
  resolveShipmentOrderId,
  invokeRealPayment,
  closeCjSupplierPayment,
};
