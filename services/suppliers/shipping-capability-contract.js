/**
 * @komerce-arch
 * @role          shipping-capability-contract
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        normalized provider shipping capability
 * @outputs       exact canonical shipping capability or fail-closed validation error
 * @depends       none
 * @used-by       provider shipping capability adapters and contract proofs
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md
 * @impact-areas  purchasing, supplier-integration
 */
'use strict';

const DELIVERY_KIND = Object.freeze({ PHYSICAL: 'PHYSICAL', ELECTRONIC: 'ELECTRONIC' });
const MANAGEMENT_MODE = Object.freeze({ SELLER: 'SELLER', PROVIDER: 'PROVIDER' });
const FULFILLMENT_MODE = Object.freeze({ SELLER: 'SELLER', PROVIDER: 'PROVIDER' });
const ALLOWED_KEYS = Object.freeze([
  'provider',
  'environment',
  'provider_ref',
  'delivery_kind',
  'dispatch_country',
  'management_mode',
  'fulfillment_mode',
  'bindable_to_standard_offer',
]);

function token(value) {
  return String(value || '').trim();
}

function normalizeProvider(value) {
  const provider = token(value).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(provider)) throw new Error('SHIPPING_CAPABILITY_PROVIDER_INVALID');
  return provider;
}

function normalizeEnvironment(value) {
  const environment = token(value).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(environment)) throw new Error('SHIPPING_CAPABILITY_ENVIRONMENT_INVALID');
  return environment;
}

function normalizeCapability(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('SHIPPING_CAPABILITY_INVALID');
  const unexpected = Object.keys(input).filter(key => !ALLOWED_KEYS.includes(key));
  if (unexpected.length) throw new Error(`SHIPPING_CAPABILITY_PROVIDER_FIELD_LEAK_${unexpected[0].toUpperCase()}`);

  const providerRef = token(input.provider_ref);
  if (!providerRef || providerRef.length > 160) throw new Error('SHIPPING_CAPABILITY_PROVIDER_REF_INVALID');

  const deliveryKind = token(input.delivery_kind).toUpperCase();
  if (!Object.values(DELIVERY_KIND).includes(deliveryKind)) throw new Error('SHIPPING_CAPABILITY_DELIVERY_KIND_INVALID');

  const dispatchCountry = token(input.dispatch_country).toUpperCase();
  if (!/^[A-Z]{2}$/.test(dispatchCountry)) throw new Error('SHIPPING_CAPABILITY_DISPATCH_COUNTRY_INVALID');

  const managementMode = token(input.management_mode).toUpperCase();
  if (!Object.values(MANAGEMENT_MODE).includes(managementMode)) throw new Error('SHIPPING_CAPABILITY_MANAGEMENT_MODE_INVALID');

  const fulfillmentMode = token(input.fulfillment_mode).toUpperCase();
  if (!Object.values(FULFILLMENT_MODE).includes(fulfillmentMode)) throw new Error('SHIPPING_CAPABILITY_FULFILLMENT_MODE_INVALID');

  if (typeof input.bindable_to_standard_offer !== 'boolean') throw new Error('SHIPPING_CAPABILITY_BINDABLE_INVALID');

  return Object.freeze({
    provider: normalizeProvider(input.provider),
    environment: normalizeEnvironment(input.environment),
    provider_ref: providerRef,
    delivery_kind: deliveryKind,
    dispatch_country: dispatchCountry,
    management_mode: managementMode,
    fulfillment_mode: fulfillmentMode,
    bindable_to_standard_offer: input.bindable_to_standard_offer,
  });
}

module.exports = {
  DELIVERY_KIND,
  MANAGEMENT_MODE,
  FULFILLMENT_MODE,
  normalizeCapability,
};
