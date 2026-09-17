/**
 * @komerce-arch
 * @role          allegro-shipping-capability-adapter
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        sanitized Allegro shipping-rate detail
 * @outputs       canonical ShippingCapability
 * @depends       services/suppliers/shipping-capability-contract.js
 * @used-by       scripts/allegro-shipping-capability-proof.js, provider contract tests
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md
 * @impact-areas  purchasing, supplier-integration
 */
'use strict';

const { normalizeCapability } = require('./shipping-capability-contract');

const provider = 'allegro';
const environment = 'sandbox';

function requiredBoolean(value, field) {
  if (typeof value !== 'boolean') throw new Error(`ALLEGRO_SHIPPING_CAPABILITY_UNKNOWN_${field}`);
  return value;
}

function adaptShippingRate(detail) {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
    throw new Error('ALLEGRO_SHIPPING_CAPABILITY_DETAIL_INVALID');
  }

  const managedByAllegro = requiredBoolean(detail.managed_by_allegro, 'MANAGEMENT');
  const isFulfillment = requiredBoolean(detail.is_fulfillment, 'FULFILLMENT');

  const type = String(detail.type || '').trim().toUpperCase();
  if (!type) throw new Error('ALLEGRO_SHIPPING_CAPABILITY_UNKNOWN_TYPE');

  const dispatchCountry = String(detail.dispatch_country || '').trim().toUpperCase();
  if (!dispatchCountry) throw new Error('ALLEGRO_SHIPPING_CAPABILITY_UNKNOWN_DISPATCH_COUNTRY');

  const managementMode = managedByAllegro ? 'PROVIDER' : 'SELLER';
  const fulfillmentMode = isFulfillment ? 'PROVIDER' : 'SELLER';
  const bindable = type === 'PHYSICAL'
    && dispatchCountry === 'PL'
    && managementMode === 'SELLER'
    && fulfillmentMode === 'SELLER';

  return normalizeCapability({
    provider,
    environment,
    provider_ref: detail.id,
    delivery_kind: type,
    dispatch_country: dispatchCountry,
    management_mode: managementMode,
    fulfillment_mode: fulfillmentMode,
    bindable_to_standard_offer: bindable,
  });
}

module.exports = {
  provider,
  environment,
  adaptShippingRate,
};
