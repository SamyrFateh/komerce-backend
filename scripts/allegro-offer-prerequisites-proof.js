/**
 * @komerce-arch
 * @role          allegro-offer-prerequisites-proof
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        Allegro Sandbox seller settings and shipping detail reads
 * @outputs       P0-P3 provider contract proof and exact offer prerequisite bundle
 * @depends       services/suppliers/allegro-sandbox-client.js, services/suppliers/allegro-shipping-capability-adapter.js, scripts/provider-contract-proof.js
 * @used-by       operator CLI, Allegro Golden prerequisite proof
 * @db-read       supplier_oauth_connections
 * @db-write      supplier_oauth_connections; OAuth refresh rotation only
 * @db-txn        delegated
 * @doctrine      docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md
 * @impact-areas  catalog, supplier-integration, tests
 */
'use strict';

const client = require('../services/suppliers/allegro-sandbox-client');
const { adaptShippingRate } = require('../services/suppliers/allegro-shipping-capability-adapter');
const { buildProof, assertThrough, summary } = require('./provider-contract-proof');

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

  const capabilities = [];
  for (const ref of candidateShippingRateRefs(settings)) {
    capabilities.push(adaptShippingRate(await api.getShippingRateDetail(ref)));
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

async function proveOfferPrerequisites(api = client) {
  const settings = await api.getSellerSettings();
  let prerequisites = null;
  let error = null;
  try {
    prerequisites = await resolveOfferPrerequisites(settings, api);
  } catch (cause) {
    error = String(cause?.message || cause);
  }

  const shipping = prerequisites?.shipping_capability || null;
  const composed = Boolean(shipping?.bindable_to_standard_offer
    && prerequisites?.return_policy_ref && prerequisites?.implied_warranty_ref);

  const proof = buildProof({
    provider: 'ALLEGRO',
    environment: 'SANDBOX',
    conversation: {
      operation: 'OFFER_PREREQUISITES_PIPELINE',
      phases: {
        EXPECTS: [{ id: 'STANDARD_OFFER_PREREQUISITES', state: 'KNOWN', evidence: 'KOMERCE_OFFER_PIPELINE' }],
        REQUIRES: [
          { id: 'CANONICAL_SHIPPING_CAPABILITY', state: shipping ? 'DERIVED' : 'UNKNOWN', evidence: shipping?.provider_ref || error },
          { id: 'RETURN_POLICY_REFERENCE', state: prerequisites?.return_policy_ref ? 'KNOWN' : 'UNKNOWN', evidence: prerequisites?.return_policy_ref || error },
          { id: 'IMPLIED_WARRANTY_REFERENCE', state: prerequisites?.implied_warranty_ref ? 'KNOWN' : 'UNKNOWN', evidence: prerequisites?.implied_warranty_ref || error },
        ],
        SENDS: [{ id: 'SELLER_SETTINGS_AND_DETAIL_READS', state: 'KNOWN', evidence: 'READ_ONLY' }],
        RECEIVES: [{ id: 'PROVIDER_PREREQUISITE_FACTS', state: settings ? 'KNOWN' : 'UNKNOWN', evidence: settings ? 'SELLER_SETTINGS' : 'NO_SETTINGS' }],
        CONFIRMS: [{ id: 'PIPELINE_COMPOSITION', state: composed ? 'DERIVED' : 'UNKNOWN', evidence: composed ? 'CANONICAL_SHIPPING_PLUS_PROVIDER_REFERENCES' : error }],
        EXPOSES: [{ id: 'OFFER_PREREQUISITE_BUNDLE', state: composed ? 'DERIVED' : 'UNKNOWN', evidence: composed ? shipping.provider_ref : error }],
      },
    },
    stages: {
      P0: [{ id: 'SELLER_SETTINGS_AVAILABLE', pass: Boolean(settings), evidence: settings ? 'READ_OK' : 'NO_SETTINGS' }],
      P1: [{ id: 'PROVIDER_DETAIL_READS', pass: Boolean(settings), evidence: 'SELLER_SETTINGS_PLUS_SHIPPING_DETAIL' }],
      P2: [{ id: 'CANONICAL_SHIPPING_CAPABILITY', pass: Boolean(shipping?.bindable_to_standard_offer), evidence: shipping?.provider_ref || error }],
      P3: [{ id: 'OFFER_PREREQUISITES_COMPOSED', pass: composed, evidence: composed ? shipping.provider_ref : error }],
    },
  });

  assertThrough(proof, 'P3');
  return { prerequisites, contract_proof: summary(proof) };
}

async function run(argv, api = client) {
  if (argv.length) throw new Error('Usage: node scripts/allegro-offer-prerequisites-proof.js');
  return proveOfferPrerequisites(api);
}

if (require.main === module) {
  run(process.argv.slice(2)).then(report => console.log(JSON.stringify(report, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; })
    .finally(async () => { await require('../db').pool.end(); process.exit(process.exitCode || 0); });
}

module.exports = {
  candidateShippingRateRefs,
  eligibleReturnPolicy,
  impliedWarranty,
  resolveOfferPrerequisites,
  proveOfferPrerequisites,
  run,
};
