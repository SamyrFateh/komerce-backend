/**
 * @komerce-arch
 * @role          supplier-fulfillment-runtime
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        persisted supplier execution order + exact supplier unit/quantity + provider context
 * @outputs       provider read-back reconciliation + durable supplier fulfillment fact
 * @depends       services/suppliers/cj-fulfillment-reader.js, services/suppliers/aliexpress-fulfillment-reader.js, services/suppliers/allegro-fulfillment-reader.js, services/suppliers/supplier-fulfillment-persistence.js
 * @used-by       purchasing reconciliation jobs / bounded operator flows
 * @db-read       supplier_execution_orders
 * @db-write      supplier_execution_fulfillments, supplier_execution_events
 * @db-txn        caller_owned_transaction
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_FULFILLMENT_FACT.md
 * @impact-areas  purchasing, supplier-integration, reconciliation
 */
'use strict';

const cj = require('./cj-fulfillment-reader');
const aliexpress = require('./aliexpress-fulfillment-reader');
const allegro = require('./allegro-fulfillment-reader');
const { persistSupplierFulfillment } = require('./supplier-fulfillment-persistence');

const READERS = Object.freeze({
  cj: async ({ supplierOrderId, supplierUnitRef, expectedQuantity, context }) =>
    cj.readAndReconcile({ supplierOrderId, supplierUnitRef, expectedQuantity, context }),
  aliexpress: async ({ supplierOrderId, supplierUnitRef, expectedQuantity, context }) =>
    aliexpress.readAndReconcile({ supplierOrderId, supplierUnitRef, expectedQuantity, context }),
  allegro: async ({ supplierOrderId, supplierUnitRef, expectedQuantity, context }) =>
    allegro.readAndReconcile({
      checkoutFormId: supplierOrderId,
      supplierUnitRef,
      expectedQuantity,
      context,
    }),
});

function text(value) {
  const v = String(value || '').trim();
  return v || null;
}

async function reconcileAndPersistSupplierFulfillment(client, {
  supplierExecutionOrderId,
  supplierUnitRef,
  expectedQuantity,
  context = {},
} = {}) {
  if (!client || typeof client.query !== 'function') {
    throw new Error('SUPPLIER_FULFILLMENT_DB_CLIENT_REQUIRED');
  }

  const executionOrderId = text(supplierExecutionOrderId);
  const unitRef = text(supplierUnitRef);
  const quantity = Number(expectedQuantity);

  if (!executionOrderId) throw new Error('SUPPLIER_EXECUTION_ORDER_ID_REQUIRED');
  if (!unitRef) throw new Error('SUPPLIER_FULFILLMENT_UNIT_REF_REQUIRED');
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error('SUPPLIER_FULFILLMENT_EXPECTED_QUANTITY_INVALID');
  }

  const { rows } = await client.query(`
    SELECT id, provider, supplier_order_id
      FROM supplier_execution_orders
     WHERE id = $1
  `, [executionOrderId]);

  const order = rows[0];
  if (!order) throw new Error('SUPPLIER_EXECUTION_ORDER_NOT_FOUND');

  const provider = text(order.provider)?.toLowerCase();
  const reader = READERS[provider];
  if (!reader) throw new Error(`SUPPLIER_FULFILLMENT_READER_UNSUPPORTED:${provider || 'UNKNOWN'}`);

  const reconciliationResult = await reader({
    supplierOrderId: String(order.supplier_order_id),
    supplierUnitRef: unitRef,
    expectedQuantity: quantity,
    context,
  });

  const fulfillment = await persistSupplierFulfillment(client, {
    supplierExecutionOrderId: executionOrderId,
    supplierUnitRef: unitRef,
    reconciliationResult,
  });

  return {
    provider,
    supplier_execution_order_id: executionOrderId,
    supplier_order_id: String(order.supplier_order_id),
    supplier_unit_ref: unitRef,
    reconciliation: reconciliationResult,
    fulfillment,
  };
}

module.exports = {
  READERS,
  reconcileAndPersistSupplierFulfillment,
};
