/**
 * @komerce-arch
 * @role          procurement-execution-context
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        purchase_order identity, purchase line/item identity, procurement hub configuration
 * @outputs       provider-neutral execution context
 * @depends       none
 * @used-by       services/purchasing-trigger-service.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md
 * @impact-areas  purchasing, supplier-integration
 */
'use strict';

function nonEmpty(value) {
  const text = String(value || '').trim();
  return text || null;
}

function parseDestination(env = process.env) {
  const raw = nonEmpty(env.KOMERCE_PROCUREMENT_HUB_DESTINATION_JSON);
  if (!raw) return null;

  let value;
  try { value = JSON.parse(raw); }
  catch (_) { throw new Error('PROCUREMENT_HUB_DESTINATION_JSON_INVALID'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('PROCUREMENT_HUB_DESTINATION_JSON_INVALID');
  }

  const countryCode = nonEmpty(value.country_code || value.countryCode);
  if (!countryCode || !/^[A-Za-z]{2,3}$/.test(countryCode)) {
    throw new Error('PROCUREMENT_HUB_COUNTRY_CODE_INVALID');
  }

  return Object.freeze({
    ...value,
    country_code: countryCode.toUpperCase(),
  });
}

function buildProcurementExecutionContext({
  purchaseOrderId,
  purchaseLineId = null,
  item = null,
  supplierTagRequest = null,
  env = process.env,
} = {}) {
  const poId = nonEmpty(purchaseOrderId);
  if (!poId) throw new Error('PURCHASE_ORDER_ID_REQUIRED');

  const hubRef = nonEmpty(env.KOMERCE_PROCUREMENT_HUB_REF) || 'DXB';
  return Object.freeze({
    execution_key: poId,
    procurement_hub_ref: hubRef,
    procurement_destination: parseDestination(env),
    store_line_item_id: nonEmpty(purchaseLineId) || nonEmpty(item?.id),
    supplier_tag_request: supplierTagRequest || null,
    env,
  });
}

module.exports = {
  parseDestination,
  buildProcurementExecutionContext,
};
