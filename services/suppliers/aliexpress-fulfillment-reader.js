/**
 * @komerce-arch
 * @role          aliexpress-provider-fulfillment-reader
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        canonical AliExpress supplier order identity, expected supplier unit/quantity, provider credentials
 * @outputs       bounded native AliExpress fulfillment facts + canonical FULFILLMENT reconciliation
 * @depends       services/suppliers/aliexpress-fulfillment-adapter.js, services/suppliers/supplier-fulfillment-reconciliation.js
 * @used-by       purchasing supplier fulfillment reconciliation runtime
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_FULFILLMENT_FACT.md
 * @impact-areas  purchasing, supplier-integration, reconciliation
 */
'use strict';

const adapter = require('./aliexpress-fulfillment-adapter');
const { reconcileFulfillment } = require('./supplier-fulfillment-reconciliation');

const provider = 'aliexpress';
const COMPLETED_PROVIDER_STATUSES = new Set([
  'WAIT_BUYER_ACCEPT_GOODS',
  'FINISH',
  'SHIPPED',
  'DELIVERED',
]);

function normalizeStatus(value) {
  return String(value || '').trim().toUpperCase();
}

function selectChildren(facts, supplierUnitRef) {
  const ref = String(supplierUnitRef || '').trim();
  if (!ref) return [];
  const children = Array.isArray(facts?.child_orders) ? facts.child_orders : [];
  return children.filter((row) =>
    String(row?.sku_id || '').trim() === ref
    || String(row?.sku_attr || '').trim() === ref
  );
}

function observedQuantityForUnit(facts, supplierUnitRef) {
  const selected = selectChildren(facts, supplierUnitRef);
  const values = selected
    .map((row) => Number(row?.quantity))
    .filter(Number.isSafeInteger);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : 0;
}

function firstNonEmpty(values) {
  return values.map((value) => String(value || '').trim()).find(Boolean) || null;
}

function mapOrderFactsToFulfillment({
  supplierOrderId,
  supplierUnitRef,
  facts = {},
} = {}) {
  const orderId = String(supplierOrderId || '').trim();
  const unitRef = String(supplierUnitRef || '').trim();
  if (!/^\d{5,30}$/.test(orderId)) throw new Error('ALIEXPRESS_ORDER_ID_INVALID');
  if (!unitRef) throw new Error('ALIEXPRESS_SUPPLIER_UNIT_REF_REQUIRED');

  const providerStatus = normalizeStatus(facts.status);
  const children = selectChildren(facts, unitRef);
  const completed = COMPLETED_PROVIDER_STATUSES.has(providerStatus);

  return {
    external_ref: orderId,
    observed: {
      supplier_order_id: String(facts.order_id || orderId),
      supplier_unit_ref: unitRef,
      quantity: observedQuantityForUnit(facts, unitRef),
      provider_status: providerStatus || null,
      carrier: firstNonEmpty([
        facts.logistics_service,
        ...children.map((row) => row.logistics_service),
      ]),
      tracking_number: firstNonEmpty([
        facts.logistics_no,
        ...children.map((row) => row.logistics_no),
      ]),
      pending: !completed,
    },
    evidence: {
      proof_source: 'aliexpress_trade_ds_order_get',
      proof_ref: orderId,
      child_order_count: children.length,
    },
  };
}

async function readAndReconcile({
  supplierOrderId,
  supplierUnitRef,
  expectedQuantity,
  context = {},
} = {}) {
  const readback = await adapter.readOrderDetail(supplierOrderId, context);
  const mapped = mapOrderFactsToFulfillment({
    supplierOrderId,
    supplierUnitRef,
    facts: readback.facts,
  });

  return reconcileFulfillment({
    provider,
    externalRef: mapped.external_ref,
    expected: {
      supplier_order_id: String(supplierOrderId || '').trim(),
      supplier_unit_ref: String(supplierUnitRef || '').trim(),
      quantity: Number(expectedQuantity),
    },
    observed: mapped.observed,
    evidence: mapped.evidence,
  });
}

module.exports = {
  provider,
  COMPLETED_PROVIDER_STATUSES,
  selectChildren,
  observedQuantityForUnit,
  mapOrderFactsToFulfillment,
  readAndReconcile,
};
