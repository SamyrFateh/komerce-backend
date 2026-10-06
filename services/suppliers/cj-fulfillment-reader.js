/**
 * @komerce-arch
 * @role          cj-provider-fulfillment-reader
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        canonical CJ supplier order identity, expected supplier unit/quantity, CJ credentials
 * @outputs       bounded native CJ fulfillment facts + canonical FULFILLMENT reconciliation
 * @depends       services/suppliers/cj-fulfillment-adapter.js, services/suppliers/supplier-fulfillment-reconciliation.js
 * @used-by       purchasing supplier fulfillment reconciliation runtime
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_FULFILLMENT_FACT.md
 * @impact-areas  purchasing, supplier-integration, reconciliation
 */
'use strict';

const cjAdapter = require('./cj-fulfillment-adapter');
const { reconcileFulfillment } = require('./supplier-fulfillment-reconciliation');

const provider = 'cj';
const COMPLETED_PROVIDER_STATUSES = new Set(['SHIPPED', 'DELIVERED']);

function normalizeStatus(value) {
  return String(value || '').trim().toUpperCase();
}

function observedQuantityForUnit(facts, supplierUnitRef) {
  const ref = String(supplierUnitRef || '').trim();
  if (!ref) return null;
  const variants = Array.isArray(facts?.variants) ? facts.variants : [];
  const quantities = variants
    .filter(row => String(row?.vid || '').trim() === ref)
    .map(row => Number(row?.quantity))
    .filter(Number.isSafeInteger);
  return quantities.length ? quantities.reduce((sum, value) => sum + value, 0) : 0;
}

function mapOrderFactsToFulfillment({
  supplierOrderId,
  supplierUnitRef,
  facts = {},
  requestId = null,
} = {}) {
  const orderId = String(supplierOrderId || '').trim();
  const unitRef = String(supplierUnitRef || '').trim();
  if (!orderId) throw new Error('CJ_ORDER_ID_REQUIRED');
  if (!unitRef) throw new Error('CJ_SUPPLIER_UNIT_REF_REQUIRED');

  const providerStatus = normalizeStatus(facts.status);
  const completed = COMPLETED_PROVIDER_STATUSES.has(providerStatus);

  return {
    external_ref: orderId,
    observed: {
      supplier_order_id: String(facts.order_id || orderId),
      supplier_unit_ref: unitRef,
      quantity: observedQuantityForUnit(facts, unitRef),
      provider_status: providerStatus || null,
      provider_sub_status: facts.sub_status ? String(facts.sub_status) : null,
      carrier: facts.tracking_provider || facts.logistic_name || null,
      tracking_number: facts.tracking_number || null,
      tracking_url: facts.tracking_url || null,
      pending: !completed,
    },
    evidence: {
      proof_source: 'cj_order_detail',
      proof_ref: orderId,
      request_id: requestId || null,
      cj_order_code: facts.cj_order_code || null,
      shipment_order_id: facts.shipment_order_id || null,
      sandbox: facts.is_sandbox === true,
    },
  };
}

async function readAndReconcile({
  supplierOrderId,
  supplierUnitRef,
  expectedQuantity,
  context = {},
} = {}) {
  const readback = await cjAdapter.readOrderDetail(supplierOrderId, context);
  const mapped = mapOrderFactsToFulfillment({
    supplierOrderId,
    supplierUnitRef,
    facts: readback.facts,
    requestId: readback.request_id,
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
  observedQuantityForUnit,
  mapOrderFactsToFulfillment,
  readAndReconcile,
};
