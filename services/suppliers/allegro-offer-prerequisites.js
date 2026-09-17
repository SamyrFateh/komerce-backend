/**
 * @komerce-arch
 * @role          allegro-offer-prerequisites
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        sanitized Allegro seller settings and shipping-rate detail reads
 * @outputs       exact Allegro offer prerequisite bundle carrying canonical ShippingCapability
 * @depends       services/suppliers/allegro-shipping-capability-adapter.js
 * @used-by       scripts/allegro-offer-prerequisites-proof.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md
 * @impact-areas  catalog, supplier-integration
 */
'use strict';

const { adaptShippingRate } = require('./allegro-shipping-capability-adapter');

function candidateShippingRateRefs(settings) {
  return (Array.isArray(settings?.shipping_rates) ? settings.shipping_rates : [])
    .filter(row => row?.id && row?.managed_by_allegro === false && row?.is_fulfillment === false)
    .map(row => String(row.id));
}

function eligibleReturnPolicy(settings) {
  return (Array.isArray(settings?.return_policies) ? settings.return_policies : [])
    .find(row => row?.id && row?.is_fulfillment === false
      && row?.availability_range === 'FULL' && row?.withdrawal_period === 'P14D') || null;
}

function impliedWarranty(settings) {
  return (Array.isArray(settings?.implied_warranties) ? settings.implied_warranties : [])
    .find(row => row?.id) || null;
}

async function resolveOfferPrerequisites(settings, api) {
  if (!api || typeof api.getShippingRateDetail !== 'function') {
    throw new Error('ALLEGRO_OFFER_PREREQUISITES_DETAIL_READER_REQUIRED');
  }

  const refs = candidateShippingRateRefs(settings);
  const capabilities = [];
  for (const ref of refs) {
    const detail = await api.getShippingRateDetail(ref);
    capabilities.push(adaptShippingRate(detail));
  }

  const bindable = capabilities.filter(capability => capability.bindable_to_standard_offer === true);
  if (bindable.length > 1) throw new Error('ALLEGRO_OFFER_PREREQUISITES_SHIPPING_AMBIGUOUS');

  const shippingCapability = bindable[0] || null;
  const returns = eligibleReturnPolicy(settings);
  const implied = impliedWarranty(settings);
  const missing = [];
  if (!shippingCapability) missing.push('SHIPPING_CAPABILITY');
  if (!returns?.id) missing.push('RETURN_POLICY');
  if (!implied?.id) missing.push('IMPLIED_WARRANTY');
  if (missing.length) throw new Error(`ALLEGRO_OFFER_PREREQUISITES_MISSING_${missing.join('_')}`);

  return Object.freeze({
    shipping_capability: shippingCapability,
    return_policy_ref: String(returns.id),
    implied_warranty_ref: String(implied.id),
  });
}

module.exports = {
  candidateShippingRateRefs,
  eligibleReturnPolicy,
  impliedWarranty,
  resolveOfferPrerequisites,
};
