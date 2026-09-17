/**
 * @komerce-arch
 * @role          allegro-shipping-rate-contract
 * @domain        purchasing
 * @layer         script
 * @criticality   high
 * @inputs        Allegro sandbox shipping rates, rate details and delivery-method constraints
 * @outputs       bounded shipping conversation proof and optional guarded seller rate provisioning
 * @depends       services/suppliers/allegro-sandbox-client.js, scripts/provider-contract-proof.js
 * @used-by       operator CLI, Allegro Golden prerequisite proof
 * @db-read       supplier_oauth_connections
 * @db-write      supplier_oauth_connections; provider shipping rate only with --ensure
 * @db-txn        delegated
 * @doctrine      docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md
 * @impact-areas  purchasing, supplier-integration, tests
 */
'use strict';

const client = require('../services/suppliers/allegro-sandbox-client');
const { buildProof, assertConversation, assertThrough, summary } = require('./provider-contract-proof');

function candidateSellerRates(settings) {
  return (Array.isArray(settings?.shipping_rates) ? settings.shipping_rates : [])
    .filter(row => row?.managed_by_allegro === false && row?.is_fulfillment === false);
}

function shippingRateDecision(detail) {
  if (!detail) return 'UNKNOWN';
  if (detail.managed_by_allegro !== false || detail.is_fulfillment !== false) return 'REJECTED';
  if (detail.type == null || detail.dispatch_country == null) return 'UNKNOWN';
  if (detail.type !== 'PHYSICAL' || detail.dispatch_country !== 'PL') return 'REJECTED';
  return 'ELIGIBLE';
}

function deliveryMethodDecision(method) {
  if (!method) return 'UNKNOWN';
  if (method.dispatch_country == null || method.destination_country == null || method.payment_policy == null) return 'UNKNOWN';
  if (method.dispatch_country !== 'PL' || method.destination_country !== 'PL' || method.payment_policy !== 'IN_ADVANCE') return 'REJECTED';

  const c = method.shipping_rates_constraints || {};
  if (c.allowed == null) return 'UNKNOWN';
  if (c.allowed === false) return 'REJECTED';
  if (!Number.isSafeInteger(c.max_quantity_per_package_max) || c.max_quantity_per_package_max < 1) return 'UNKNOWN';

  const price = c.first_item_rate || {};
  if (price.currency == null) return 'UNKNOWN';
  if (price.currency !== 'PLN') return 'REJECTED';
  if (price.min == null || price.max == null) return 'UNKNOWN';
  if (Number(price.min) > Number(price.max)) return 'UNKNOWN';

  const time = c.shipping_time?.default || {};
  if (!time.from || !time.to) return 'UNKNOWN';

  const weight = c.max_package_weight || {};
  if (weight.supported == null) return 'UNKNOWN';
  if (weight.supported === true) {
    if (!weight.min || !weight.max || !weight.unit || Number(weight.min) > Number(weight.max)) return 'UNKNOWN';
  }
  return 'ELIGIBLE';
}

function selectDeliveryMethod(methods) {
  const rows = Array.isArray(methods) ? methods : [];
  const eligible = rows.filter(row => deliveryMethodDecision(row) === 'ELIGIBLE')
    .sort((a, b) => a.id.localeCompare(b.id));
  return eligible[0] || null;
}

function buildCreatePayload(method) {
  if (deliveryMethodDecision(method) !== 'ELIGIBLE') throw new Error('ALLEGRO_SHIPPING_METHOD_NOT_ELIGIBLE');
  const c = method.shipping_rates_constraints;
  const rate = {
    deliveryMethod: { id: method.id },
    maxQuantityPerPackage: 1,
    firstItemRate: { amount: c.first_item_rate.min, currency: 'PLN' },
    shippingTime: {
      from: c.shipping_time.default.from,
      to: c.shipping_time.default.to,
    },
  };
  if (c.max_package_weight.supported === true) {
    rate.maxPackageWeight = {
      value: c.max_package_weight.min,
      unit: c.max_package_weight.unit,
    };
  }
  return {
    name: client.GOLDEN_SHIPPING_RATE_NAME,
    type: 'PHYSICAL',
    dispatchCountry: 'PL',
    rates: [rate],
  };
}

function buildShippingProof({ settings, details, deliveryMethods, confirmedRate = null, selectedMethod = null }) {
  const shippingRows = Array.isArray(settings?.shipping_rates) ? settings.shipping_rates : [];
  const detailRows = Array.isArray(details) ? details : [];
  const eligible = detailRows.find(row => shippingRateDecision(row) === 'ELIGIBLE') || null;
  const unknownCandidateDetails = detailRows.filter(row => shippingRateDecision(row) === 'UNKNOWN');
  const allFlagsObserved = shippingRows.every(row => typeof row?.managed_by_allegro === 'boolean' && typeof row?.is_fulfillment === 'boolean');
  const methods = Array.isArray(deliveryMethods) ? deliveryMethods : [];
  const method = selectedMethod || selectDeliveryMethod(methods);
  const unknownMethods = methods.filter(row => deliveryMethodDecision(row) === 'UNKNOWN');
  const confirmed = confirmedRate && shippingRateDecision(confirmedRate) === 'ELIGIBLE' ? confirmedRate : null;
  const existingOrConfirmed = eligible || confirmed;

  let createPayloadState = 'KNOWN';
  let createPayloadEvidence = existingOrConfirmed ? 'NOT_REQUIRED_EXISTING_RATE' : 'NO_COMPATIBLE_METHOD';
  if (!existingOrConfirmed && (!allFlagsObserved || unknownCandidateDetails.length > 0)) {
    // Creating a new rate is not yet a decision-relevant action. First finish
    // confirming whether an existing seller-owned rate already satisfies us.
    createPayloadEvidence = 'NOT_REQUIRED_UNTIL_EXISTING_RATE_DECISION';
  } else if (!existingOrConfirmed && method) {
    createPayloadState = 'DERIVED';
    createPayloadEvidence = `DELIVERY_METHOD_${method.id}`;
  } else if (!existingOrConfirmed && unknownMethods.length > 0) {
    createPayloadState = 'UNKNOWN';
    createPayloadEvidence = `${unknownMethods.length}_DELIVERY_METHODS_INCOMPLETE`;
  }

  const businessReady = Boolean(existingOrConfirmed || method);
  const rawApiReady = Boolean(existingOrConfirmed);

  return buildProof({
    provider: 'ALLEGRO',
    environment: 'SANDBOX',
    conversation: {
      operation: 'SELLER_SHIPPING_RATE',
      phases: {
        EXPECTS: [
          { id: 'SELLER_MANAGED_PHYSICAL_PL_RATE', state: 'KNOWN', evidence: 'STANDARD_SELLER_OFFER' },
        ],
        REQUIRES: [
          { id: 'TYPE', state: 'KNOWN', evidence: 'PHYSICAL' },
          { id: 'DISPATCH_COUNTRY', state: 'KNOWN', evidence: 'PL' },
          { id: 'DELIVERY_METHOD_CONSTRAINTS', state: 'KNOWN', evidence: 'GET_SALE_DELIVERY_METHODS' },
          { id: 'READ_BACK', state: 'KNOWN', evidence: 'GET_SALE_SHIPPING_RATES_ID' },
        ],
        SENDS: [
          { id: 'RATE_DISCOVERY', state: 'KNOWN', evidence: 'GET_SALE_SHIPPING_RATES' },
          { id: 'CREATE_PAYLOAD', state: createPayloadState, evidence: createPayloadEvidence },
        ],
        RECEIVES: [
          // Receiving a response is distinct from being able to confirm the
          // business decision from it. Missing decision fields are handled below.
          { id: 'SHIPPING_RATE_LIST', state: 'KNOWN', evidence: `${shippingRows.length}_RATES_OBSERVED` },
          { id: 'CANDIDATE_DETAILS', state: 'KNOWN', evidence: `${detailRows.length}_DETAILS_READ` },
          { id: 'DELIVERY_METHODS', state: 'KNOWN', evidence: eligible ? 'NOT_REQUIRED' : `${methods.length}_METHODS_OBSERVED` },
        ],
        CONFIRMS: [
          { id: 'EXISTING_RATE_DECISION', state: (!allFlagsObserved || unknownCandidateDetails.length) && !eligible ? 'UNKNOWN' : 'KNOWN', evidence: eligible?.id || 'NONE_ELIGIBLE_OBSERVED' },
          { id: 'DELIVERY_METHOD_DECISION', state: eligible ? 'KNOWN' : (method ? 'KNOWN' : (unknownMethods.length ? 'UNKNOWN' : 'KNOWN')), evidence: eligible ? 'NOT_REQUIRED' : (method?.id || 'NONE_COMPATIBLE_OBSERVED') },
        ],
        EXPOSES: [
          { id: 'SHIPPING_RATE_REF', state: 'KNOWN', evidence: existingOrConfirmed?.id || 'PROVIDER_UUID_AFTER_CONFIRMED_CREATE' },
          { id: 'SELLER_MANAGED', state: 'KNOWN', evidence: 'FALSE_REQUIRED' },
          { id: 'FULFILLMENT', state: 'KNOWN', evidence: 'FALSE_REQUIRED' },
          { id: 'TYPE_AND_ORIGIN', state: 'KNOWN', evidence: 'PHYSICAL_PL' },
        ],
      },
    },
    stages: {
      P0: [
        { id: 'EXISTING_OR_CREATABLE_SHIPPING_RATE', pass: businessReady, evidence: existingOrConfirmed?.id || method?.id || 'NONE' },
      ],
      P1: [
        { id: 'DISCOVERY_API', pass: true, evidence: eligible ? 'LIST_AND_DETAIL_OK' : 'LIST_DETAIL_AND_METHODS_OK' },
        { id: 'CREATE_AND_READBACK', pass: rawApiReady, evidence: existingOrConfirmed?.id || 'NOT_YET_CONFIRMED' },
      ],
    },
  });
}

async function inspectShippingRate(api = client) {
  const settings = await api.getSellerSettings();
  const shippingRows = Array.isArray(settings?.shipping_rates) ? settings.shipping_rates : [];
  const allFlagsObserved = shippingRows.every(row => typeof row?.managed_by_allegro === 'boolean' && typeof row?.is_fulfillment === 'boolean');
  const candidates = allFlagsObserved ? candidateSellerRates(settings) : [];
  const details = [];
  for (const row of candidates) details.push(await api.getShippingRateDetail(row.id));

  const existing = details.find(row => shippingRateDecision(row) === 'ELIGIBLE') || null;
  const unknownCandidate = details.some(row => shippingRateDecision(row) === 'UNKNOWN');
  let deliveryMethods = [];
  let selectedMethod = null;
  let createPayload = null;
  if (!existing && allFlagsObserved && !unknownCandidate) {
    const observed = await api.getDeliveryMethods({ marketplace: 'allegro-pl' });
    deliveryMethods = Array.isArray(observed?.delivery_methods) ? observed.delivery_methods : [];
    selectedMethod = selectDeliveryMethod(deliveryMethods);
    if (selectedMethod) createPayload = buildCreatePayload(selectedMethod);
  }

  const proof = buildShippingProof({ settings, details, deliveryMethods, selectedMethod });
  const p0 = proof.stages.find(stage => stage.id === 'P0');
  const p1 = proof.stages.find(stage => stage.id === 'P1');
  return {
    proof,
    existing,
    selected_method: selectedMethod,
    create_payload: createPayload,
    exchange: {
      expected: {
        type: 'PHYSICAL', dispatch_country: 'PL', managed_by_allegro: false, is_fulfillment: false,
      },
      received: {
        shipping_rates: shippingRows.length,
        seller_managed_candidates: candidates.length,
        candidate_details: details.length,
        delivery_methods: deliveryMethods.length,
      },
      confirmed: {
        existing_shipping_rate_ref: existing?.id || null,
        creatable_delivery_method_ref: selectedMethod?.id || null,
      },
    },
    conversation_ready: proof.conversation.status === 'PASS',
    p0_ready: p0?.status === 'PASS',
    p1_ready: p1?.status === 'PASS',
  };
}

function readbackMatches(detail, methodId) {
  return shippingRateDecision(detail) === 'ELIGIBLE'
    && Array.isArray(detail?.rates)
    && detail.rates.some(rate => rate?.delivery_method_id === methodId
      && Number.isSafeInteger(rate?.max_quantity_per_package)
      && rate.max_quantity_per_package >= 1
      && rate?.first_item_rate?.currency === 'PLN'
      && rate?.first_item_rate?.amount
      && rate?.shipping_time?.from
      && rate?.shipping_time?.to);
}

async function ensureShippingRate(api = client) {
  const inspected = await inspectShippingRate(api);
  assertConversation(inspected.proof);
  assertThrough(inspected.proof, 'P0');
  if (inspected.existing) {
    assertThrough(inspected.proof, 'P1');
    return { ...inspected, created: false, shipping_rate_ref: inspected.existing.id };
  }
  if (!inspected.create_payload || !inspected.selected_method) throw new Error('ALLEGRO_SHIPPING_RATE_NOT_CREATABLE');

  const created = await api.createGoldenShippingRate(inspected.create_payload);
  const readback = await api.getShippingRateDetail(created.id);
  if (!readbackMatches(readback, inspected.selected_method.id)) throw new Error('ALLEGRO_SHIPPING_RATE_READBACK_MISMATCH');

  const proof = buildShippingProof({
    settings: await api.getSellerSettings(),
    details: [readback],
    deliveryMethods: [],
    confirmedRate: readback,
    selectedMethod: inspected.selected_method,
  });
  assertThrough(proof, 'P1');
  return {
    ...inspected,
    proof,
    created: true,
    shipping_rate_ref: readback.id,
    exchange: {
      ...inspected.exchange,
      confirmed: {
        existing_shipping_rate_ref: null,
        creatable_delivery_method_ref: inspected.selected_method.id,
        created_shipping_rate_ref: readback.id,
        readback: 'PHYSICAL_PL_SELLER_MANAGED_NON_FULFILLMENT',
      },
    },
    conversation_ready: true,
    p0_ready: true,
    p1_ready: true,
  };
}

async function run(argv, api = client) {
  const ensure = argv.includes('--ensure');
  if (argv.length > 1 || (argv.length === 1 && !ensure && argv[0] !== '--inspect')) {
    throw new Error('Usage: node scripts/allegro-shipping-rate-contract.js [--inspect|--ensure]');
  }
  const result = ensure ? await ensureShippingRate(api) : await inspectShippingRate(api);
  return {
    environment: 'sandbox',
    mode: ensure ? 'ensure' : 'inspect',
    created: Boolean(result.created),
    shipping_rate_ref: result.shipping_rate_ref || result.existing?.id || null,
    conversation_ready: result.conversation_ready,
    p0_ready: result.p0_ready,
    p1_ready: result.p1_ready,
    exchange: result.exchange,
    request: result.create_payload,
    contract_proof: summary(result.proof),
  };
}

if (require.main === module) {
  run(process.argv.slice(2)).then(report => {
    console.log(JSON.stringify(report, null, 2));
    if (!report.conversation_ready || !report.p0_ready || (report.mode === 'ensure' && !report.p1_ready)) process.exitCode = 1;
  }).catch(error => { console.error(error.message); process.exitCode = 1; })
    .finally(async () => { await require('../db').pool.end(); process.exit(process.exitCode || 0); });
}

module.exports = {
  candidateSellerRates,
  shippingRateDecision,
  deliveryMethodDecision,
  selectDeliveryMethod,
  buildCreatePayload,
  buildShippingProof,
  inspectShippingRate,
  readbackMatches,
  ensureShippingRate,
  run,
};
