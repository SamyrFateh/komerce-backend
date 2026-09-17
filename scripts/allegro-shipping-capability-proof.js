/**
 * @komerce-arch
 * @role          allegro-shipping-capability-proof
 * @domain        purchasing
 * @layer         script
 * @criticality   high
 * @inputs        confirmed Allegro Sandbox shipping-rate id
 * @outputs       canonical ShippingCapability and P0-P2 contract proof
 * @depends       services/suppliers/allegro-sandbox-client.js, services/suppliers/allegro-shipping-capability-adapter.js, scripts/provider-contract-proof.js
 * @used-by       operator CLI, Allegro Golden prerequisite proof
 * @db-read       supplier_oauth_connections
 * @db-write      supplier_oauth_connections; OAuth refresh rotation only
 * @db-txn        delegated
 * @doctrine      docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md
 * @impact-areas  purchasing, supplier-integration, tests
 */
'use strict';

const client = require('../services/suppliers/allegro-sandbox-client');
const adapter = require('../services/suppliers/allegro-shipping-capability-adapter');
const { buildProof, assertThrough, summary } = require('./provider-contract-proof');

async function proveShippingCapability(shippingRateId, api = client) {
  const detail = await api.getShippingRateDetail(shippingRateId);

  let capability = null;
  let adapterError = null;
  try {
    capability = adapter.adaptShippingRate(detail);
  } catch (error) {
    adapterError = String(error?.message || error);
  }

  const adapted = Boolean(capability);
  const bindable = capability?.bindable_to_standard_offer === true;
  const proof = buildProof({
    provider: 'ALLEGRO',
    environment: 'SANDBOX',
    conversation: {
      operation: 'SHIPPING_CAPABILITY_ADAPTER',
      phases: {
        EXPECTS: [
          { id: 'CANONICAL_SHIPPING_CAPABILITY', state: 'KNOWN', evidence: 'KOMERCE_BOUNDARY_CONTRACT' },
        ],
        REQUIRES: [
          { id: 'CONFIRMED_PROVIDER_RATE', state: detail?.id ? 'KNOWN' : 'UNKNOWN', evidence: detail?.id || 'NO_RATE' },
        ],
        SENDS: [
          { id: 'READBACK_REQUEST', state: 'KNOWN', evidence: 'GET_SALE_SHIPPING_RATES_ID' },
        ],
        RECEIVES: [
          { id: 'PROVIDER_RATE_DETAIL', state: detail?.id ? 'KNOWN' : 'UNKNOWN', evidence: detail?.id || 'NO_DETAIL' },
        ],
        CONFIRMS: [
          { id: 'CANONICAL_MAPPING', state: adapted ? 'DERIVED' : 'UNKNOWN', evidence: adapted ? 'ALLEGRO_SHIPPING_CAPABILITY_ADAPTER' : adapterError },
        ],
        EXPOSES: [
          { id: 'SHIPPING_CAPABILITY', state: adapted ? 'DERIVED' : 'UNKNOWN', evidence: adapted ? capability.provider_ref : adapterError },
        ],
      },
    },
    stages: {
      P0: [
        { id: 'SELLER_SHIPPING_RATE_EXISTS', pass: Boolean(detail?.id), evidence: detail?.id || 'NONE' },
      ],
      P1: [
        { id: 'SHIPPING_RATE_READBACK', pass: Boolean(detail?.id), evidence: detail?.id || 'NONE' },
      ],
      P2: [
        { id: 'CANONICAL_ADAPTER', pass: adapted, evidence: adapted ? capability.provider_ref : adapterError },
        { id: 'STANDARD_OFFER_CAPABILITY', pass: bindable, evidence: adapted ? String(capability.bindable_to_standard_offer) : adapterError },
      ],
    },
  });

  assertThrough(proof, 'P2');
  return {
    shipping_rate_ref: detail.id,
    capability,
    contract_proof: summary(proof),
  };
}

async function run(argv, api = client) {
  if (argv.length !== 1) throw new Error('Usage: node scripts/allegro-shipping-capability-proof.js SHIPPING_RATE_ID');
  return proveShippingCapability(argv[0], api);
}

if (require.main === module) {
  run(process.argv.slice(2)).then(report => {
    console.log(JSON.stringify(report, null, 2));
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  }).finally(async () => {
    await require('../db').pool.end();
    process.exit(process.exitCode || 0);
  });
}

module.exports = {
  proveShippingCapability,
  run,
};
