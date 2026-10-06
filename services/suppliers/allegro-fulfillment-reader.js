/**
 * @komerce-arch
 * @role          allegro-provider-fulfillment-reader
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        canonical Allegro checkout form identity, expected offer/quantity, sandbox client
 * @outputs       bounded native Allegro fulfillment facts + canonical FULFILLMENT reconciliation
 * @depends       services/suppliers/allegro-fulfillment-adapter.js, services/suppliers/supplier-fulfillment-reconciliation.js
 * @used-by       purchasing supplier fulfillment reconciliation runtime
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_FULFILLMENT_FACT.md
 * @impact-areas  purchasing, supplier-integration, reconciliation
 */
'use strict';

const adapter = require('./allegro-fulfillment-adapter');
const { reconcileFulfillment } = require('./supplier-fulfillment-reconciliation');

const provider = 'allegro';
const COMPLETED_FULFILLMENT_STATUSES = new Set(['SENT']);

function normalizeStatus(value) {
  return String(value || '').trim().toUpperCase();
}

function observedQuantityForOffer(facts, offerId) {
  const ref = String(offerId || '').trim();
  const lines = Array.isArray(facts?.line_items) ? facts.line_items : [];
  const values = lines
    .filter((line) => String(line?.offer_id || '').trim() === ref)
    .map((line) => Number(line?.quantity))
    .filter(Number.isSafeInteger);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : 0;
}

function mapOrderFactsToFulfillment({
  checkoutFormId,
  supplierUnitRef,
  facts = {},
} = {}) {
  const externalRef = String(checkoutFormId || '').trim().toLowerCase();
  const unitRef = String(supplierUnitRef || '').trim();
  if (!externalRef) throw new Error('ALLEGRO_CHECKOUT_FORM_ID_REQUIRED');
  if (!unitRef) throw new Error('ALLEGRO_SUPPLIER_UNIT_REF_REQUIRED');

  const fulfillmentStatus = normalizeStatus(facts.fulfillment_status);
  const completed = COMPLETED_FULFILLMENT_STATUSES.has(fulfillmentStatus);

  return {
    external_ref: externalRef,
    observed: {
      supplier_order_id: String(facts.checkout_form_id || externalRef),
      supplier_unit_ref: unitRef,
      quantity: observedQuantityForOffer(facts, unitRef),
      provider_status: fulfillmentStatus || null,
      carrier: facts.delivery_method || null,
      tracking_number: null,
      pending: !completed,
    },
    evidence: {
      proof_source: 'allegro_checkout_form',
      proof_ref: externalRef,
      order_status: facts.order_status || null,
    },
  };
}

async function readAndReconcile({
  checkoutFormId,
  supplierUnitRef,
  expectedQuantity,
  context = {},
} = {}) {
  const readback = await adapter.readOrderDetail(checkoutFormId, context);
  const mapped = mapOrderFactsToFulfillment({
    checkoutFormId,
    supplierUnitRef,
    facts: readback.facts,
  });

  return reconcileFulfillment({
    provider,
    externalRef: mapped.external_ref,
    expected: {
      supplier_order_id: String(checkoutFormId || '').trim().toLowerCase(),
      supplier_unit_ref: String(supplierUnitRef || '').trim(),
      quantity: Number(expectedQuantity),
    },
    observed: mapped.observed,
    evidence: mapped.evidence,
  });
}

module.exports = {
  provider,
  COMPLETED_FULFILLMENT_STATUSES,
  observedQuantityForOffer,
  mapOrderFactsToFulfillment,
  readAndReconcile,
};
