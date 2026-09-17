/**
 * @komerce-arch
 * @role          allegro-sandbox-check
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        explicit sandbox offer IDs or guarded bounded sandbox seed, optional contract/preparation/activation/import flags
 * @outputs       sanitized seller publication, provider contract, catalog and purchasing evidence
 * @depends       services/suppliers/connectors/allegro-connector.js, services/suppliers/allegro-fulfillment-adapter.js, services/suppliers/catalog-import-orchestrator.js, services/suppliers/allegro-sandbox-client.js, scripts/provider-contract-proof.js
 * @used-by       operator CLI
 * @db-read       supplier_oauth_connections
 * @db-write      supplier_oauth_connections; delegated canonical import writes when --import
 * @db-txn        delegated
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md, docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md
 * @impact-areas  catalog, purchasing
 */
'use strict';
const connector = require('../services/suppliers/connectors/allegro-connector');
const adapter = require('../services/suppliers/allegro-fulfillment-adapter');
const sandboxClient = require('../services/suppliers/allegro-sandbox-client');
const { buildProof, assertThrough, summary } = require('./provider-contract-proof');

const SEED_PREFIX = 'Komerce Sandbox Seed';
const SEED_SEARCHES = Object.freeze(['kabel usb', 'mysz bezprzewodowa', 'lampka led']);
const SEED_PRICES = Object.freeze([29.90, 49.90, 79.90]);
const SEED_EXTERNAL_IDS = Object.freeze([
  'komerce-sandbox-publishable-seed-1',
  'komerce-sandbox-publishable-seed-2',
  'komerce-sandbox-publishable-seed-3',
]);
const SEED_CANDIDATES_PER_SEARCH = 5;
const ACTIVATION_ATTEMPTS = 10;
const ACTIVATION_POLL_MS = 1000;
const SAFE_TASK_TOKEN_RE = /^[A-Za-z0-9_.\[\]-]{1,120}$/;

function seedCount(argv) {
  const raw = argv.find(arg => arg.startsWith('--seed='));
  if (!raw) return 0;
  const count = Number.parseInt(raw.slice('--seed='.length), 10);
  if (!Number.isSafeInteger(count) || count < 1 || count > 3) throw new Error('--seed doit être compris entre 1 et 3');
  return count;
}

function createdOfferId(payload) {
  const value = payload?.id ?? payload?.offer?.id;
  const id = value == null ? '' : String(value);
  if (!/^[0-9]{1,30}$/.test(id)) throw new Error('ALLEGRO_SANDBOX_SEED_OFFER_ID_MISSING');
  return id;
}

async function seedOfferIds(count, api = sandboxClient, env = process.env) {
  api.seedConfiguration(env);
  const ids = new Array(count).fill(null);

  for (let index = 0; index < count; index += 1) {
    const listed = await api.get('/sale/offers', { 'external.id': SEED_EXTERNAL_IDS[index] });
    const offer = (Array.isArray(listed?.offers) ? listed.offers : [])
      .find(row => String(row?.external?.id || '') === SEED_EXTERNAL_IDS[index]
        && /^[0-9]{1,30}$/.test(String(row?.id || '')));
    if (offer) ids[index] = String(offer.id);
  }

  const missing = ids.reduce((out, id, index) => id ? out : [...out, index], []);
  if (missing.length) {
    const producer = await api.ensureGoldenResponsibleProducer();
    const candidates = [];
    const seen = new Set();
    for (const phrase of SEED_SEARCHES) {
      const found = await api.searchProducts(phrase, { limit: SEED_CANDIDATES_PER_SEARCH });
      for (const row of Array.isArray(found?.products) ? found.products : []) {
        const productId = String(row?.id || '');
        if (!productId || seen.has(productId)) continue;
        seen.add(productId);
        const proof = await api.inspectProductPublishability(productId);
        if (proof.publishable) candidates.push({ ...row, proof });
      }
    }
    if (candidates.length < missing.length) {
      throw new Error(`ALLEGRO_SANDBOX_PUBLISHABLE_SEED_INCOMPLETE_${candidates.length}_OF_${missing.length}`);
    }
    for (let position = 0; position < missing.length; position += 1) {
      const index = missing[position];
      const product = candidates[position];
      const created = await api.createDraftOffer({
        productId: String(product.id),
        name: `${SEED_PREFIX} ${index + 1} - ${String(product.name || 'produit publiable')}`.slice(0, 75),
        externalId: SEED_EXTERNAL_IDS[index],
        pricePln: SEED_PRICES[index],
        stock: 10 + index,
        responsibleProducerId: producer.id,
      });
      ids[index] = createdOfferId(created);
    }
  }

  const complete = ids.filter(Boolean);
  if (complete.length !== count) throw new Error(`ALLEGRO_SANDBOX_SEED_INCOMPLETE_${complete.length}_OF_${count}`);
  return ids;
}

function sellerManagedShippingRate(settings) {
  const rows = Array.isArray(settings?.shipping_rates) ? settings.shipping_rates : [];
  return rows.find(row => row?.type === 'PHYSICAL'
    && row?.managed_by_allegro === false
    && row?.is_fulfillment === false);
}

function eligibleReturnPolicy(settings) {
  const rows = Array.isArray(settings?.return_policies) ? settings.return_policies : [];
  return rows.find(row => row?.is_fulfillment === false
    && row?.availability_range === 'FULL'
    && row?.withdrawal_period === 'P14D');
}

function buildSellerContractProof(settings) {
  const shippingRows = Array.isArray(settings?.shipping_rates) ? settings.shipping_rates : [];
  const returnRows = Array.isArray(settings?.return_policies) ? settings.return_policies : [];
  const impliedRows = Array.isArray(settings?.implied_warranties) ? settings.implied_warranties : [];
  const shipping = sellerManagedShippingRate(settings);
  const returns = eligibleReturnPolicy(settings);
  const implied = impliedRows[0];
  const shippingFeaturesObserved = shippingRows.every(row => typeof row?.managed_by_allegro === 'boolean'
    && typeof row?.is_fulfillment === 'boolean');
  const shippingTypeObserved = shippingRows.length === 0 || shippingRows.every(row => row?.type === 'PHYSICAL' || row?.type === 'ELECTRONIC');

  return buildProof({
    provider: 'ALLEGRO',
    environment: 'SANDBOX',
    conversation: {
      operation: 'SELLER_OFFER_PREREQUISITES',
      phases: {
        EXPECTS: [
          { id: 'STANDARD_SELLER_OFFER', state: 'KNOWN', evidence: 'PHYSICAL_NON_FULFILLMENT' },
        ],
        REQUIRES: [
          { id: 'SHIPPING_RATE', state: 'KNOWN', evidence: 'ALLEGRO_OFFER_DELIVERY_CONTRACT' },
          { id: 'RETURN_POLICY', state: 'KNOWN', evidence: 'ALLEGRO_AFTER_SALES_CONTRACT' },
          { id: 'IMPLIED_WARRANTY', state: 'KNOWN', evidence: 'ALLEGRO_AFTER_SALES_CONTRACT' },
        ],
        SENDS: [
          { id: 'SELLER_SETTINGS_READ', state: 'KNOWN', evidence: 'GET_SHIPPING_RETURN_WARRANTY' },
        ],
        RECEIVES: [
          { id: 'SHIPPING_RATES', state: 'KNOWN', evidence: `${shippingRows.length}_RATES_OBSERVED` },
          { id: 'RETURN_POLICIES', state: 'KNOWN', evidence: `${returnRows.length}_POLICIES_OBSERVED` },
          { id: 'IMPLIED_WARRANTIES', state: 'KNOWN', evidence: `${impliedRows.length}_WARRANTIES_OBSERVED` },
        ],
        CONFIRMS: [
          { id: 'SHIPPING_OWNERSHIP_AND_FULFILLMENT', state: shippingFeaturesObserved ? 'KNOWN' : 'UNKNOWN', evidence: `${shippingRows.length}_RATES_SANITIZED` },
          { id: 'SHIPPING_TYPE', state: shippingTypeObserved ? 'KNOWN' : 'UNKNOWN', evidence: shippingTypeObserved ? `${shippingRows.length}_RATE_TYPES_OBSERVED` : 'DETAIL_READ_REQUIRED' },
          { id: 'RETURN_POLICY_SHAPE', state: 'KNOWN', evidence: `${returnRows.length}_POLICIES_SANITIZED` },
          { id: 'IMPLIED_WARRANTY_REFERENCE', state: 'KNOWN', evidence: `${impliedRows.length}_WARRANTIES_SANITIZED` },
        ],
        EXPOSES: [
          { id: 'SELLER_MANAGED_PHYSICAL_RATE', state: 'KNOWN', evidence: shipping?.id || 'NONE_OBSERVED' },
          { id: 'ELIGIBLE_RETURN_POLICY', state: 'KNOWN', evidence: returns?.id || 'NONE_OBSERVED' },
          { id: 'IMPLIED_WARRANTY', state: 'KNOWN', evidence: implied?.id || 'NONE_OBSERVED' },
          { id: 'OFFER_PREREQUISITES_READY', state: 'DERIVED', evidence: shipping?.id && returns?.id && implied?.id ? 'ALL_REQUIRED_REFERENCES_PRESENT' : 'ONE_OR_MORE_REQUIRED_REFERENCES_MISSING' },
        ],
      },
    },
    stages: {
      P0: [
        { id: 'SELLER_MANAGED_SHIPPING_RATE', pass: Boolean(shipping?.id), evidence: shipping?.id || `${shippingRows.length}_RATES_OBSERVED` },
        { id: 'RETURN_POLICY', pass: Boolean(returns?.id), evidence: returns?.id || `${returnRows.length}_POLICIES_OBSERVED` },
        { id: 'IMPLIED_WARRANTY', pass: Boolean(implied?.id), evidence: implied?.id || `${impliedRows.length}_WARRANTIES_OBSERVED` },
      ],
      P1: [
        { id: 'SELLER_SETTINGS_API', pass: true, evidence: 'GET_SHIPPING_RETURN_WARRANTY_OK' },
        { id: 'SHIPPING_CAPABILITY_FIELDS', pass: shippingFeaturesObserved, evidence: `${shippingRows.length}_RATES_SANITIZED` },
      ],
    },
  });
}

async function observeSellerContract(api = sandboxClient) {
  const settings = await api.getSellerSettings();
  return { settings, proof: buildSellerContractProof(settings) };
}

async function probeSellerContract(api = sandboxClient) {
  const observed = await observeSellerContract(api);
  assertThrough(observed.proof, 'P1');
  return observed;
}

function selectSellerSettings(settings) {
  const shipping = sellerManagedShippingRate(settings);
  const returns = eligibleReturnPolicy(settings);
  const impliedRows = Array.isArray(settings?.implied_warranties) ? settings.implied_warranties : [];
  const implied = impliedRows[0];
  const missing = [];
  if (!shipping?.id) missing.push('SHIPPING_RATE');
  if (!returns?.id) missing.push('RETURN_POLICY');
  if (!implied?.id) missing.push('IMPLIED_WARRANTY');
  if (missing.length) throw new Error(`ALLEGRO_SANDBOX_SELLER_SETTINGS_MISSING_${missing.join('_')}`);
  return {
    shipping_rate_id: shipping.id,
    return_policy_id: returns.id,
    implied_warranty_id: implied.id,
  };
}

async function prepareOfferIds(ids, api = sandboxClient, observedSettings = null) {
  const selected = selectSellerSettings(observedSettings || await api.getSellerSettings());
  const producer = await api.ensureGoldenResponsibleProducer();
  const offers = [];
  for (const rawId of ids) {
    const id = connector.offerId(rawId);
    const current = await api.get(`/sale/product-offers/${id}`);
    const publicationStatus = String(current?.publication?.status || 'UNKNOWN').toUpperCase();
    if (publicationStatus === 'ACTIVE') {
      offers.push({ offer_id: id, skipped: true, reason: 'ALREADY_ACTIVE' });
      continue;
    }
    offers.push(await api.completeSeedOffer(id, {
      shippingRateId: selected.shipping_rate_id,
      returnPolicyId: selected.return_policy_id,
      impliedWarrantyId: selected.implied_warranty_id,
      responsibleProducerId: producer.id,
    }));
  }
  return { selected, responsible_producer_id: producer.id, offers };
}

function sanitizedPublicationTasks(payload) {
  return (Array.isArray(payload?.tasks) ? payload.tasks : []).slice(0, 20).map(task => ({
    offer_id: String(task?.offer?.id || task?.offerId || ''),
    status: SAFE_TASK_TOKEN_RE.test(String(task?.status || '').trim()) ? String(task.status).trim() : null,
    error_codes: (Array.isArray(task?.errors) ? task.errors : []).slice(0, 10)
      .map(error => String(error?.code || '').trim())
      .filter(code => SAFE_TASK_TOKEN_RE.test(code)),
  }));
}

async function activateOfferIds(ids, api = sandboxClient, {
  sleepImpl = ms => new Promise(resolve => setTimeout(resolve, ms)),
  attempts = ACTIVATION_ATTEMPTS,
  pollMs = ACTIVATION_POLL_MS,
} = {}) {
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 30) throw new Error('ALLEGRO_SANDBOX_ACTIVATION_ATTEMPTS_INVALID');
  if (!Number.isSafeInteger(pollMs) || pollMs < 0 || pollMs > 10000) throw new Error('ALLEGRO_SANDBOX_ACTIVATION_POLL_INVALID');
  const out = [];

  for (const rawId of ids) {
    const id = connector.offerId(rawId);
    let offer = await api.get(`/sale/product-offers/${id}`);
    if (String(offer?.publication?.status || '').toUpperCase() === 'ACTIVE') {
      out.push({ offer_id: id, command_id: null, publication_status: 'ACTIVE', already_active: true, tasks: [] });
      continue;
    }

    const command = await api.activateOffer(id);
    let publicationStatus = String(offer?.publication?.status || 'UNKNOWN').toUpperCase();
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0 || pollMs > 0) await sleepImpl(pollMs);
      offer = await api.get(`/sale/product-offers/${id}`);
      publicationStatus = String(offer?.publication?.status || 'UNKNOWN').toUpperCase();
      if (publicationStatus === 'ACTIVE') break;
    }

    const taskPayload = await api.getPublicationTasks(command.command_id);
    const tasks = sanitizedPublicationTasks(taskPayload);
    if (publicationStatus !== 'ACTIVE') {
      const taskStatus = tasks.map(task => task.status).filter(Boolean).join('_') || 'NO_TASK_STATUS';
      const errorCodes = [...new Set(tasks.flatMap(task => task.error_codes))].slice(0, 10);
      const diagnostic = errorCodes.length ? errorCodes.join('_') : 'NO_ERROR_CODE';
      throw new Error(`ALLEGRO_SANDBOX_ACTIVATION_NOT_ACTIVE_${id}_${publicationStatus}_${taskStatus}_${diagnostic}`);
    }
    out.push({
      offer_id: id,
      command_id: command.command_id,
      publication_status: publicationStatus,
      already_active: false,
      tasks,
    });
  }
  return out;
}

async function run(argv, {
  fetchProducts = connector.fetchProducts,
  evaluate = adapter.evaluate,
  importCatalog,
  client = sandboxClient,
  env = process.env,
  sleepImpl,
  activationAttempts = ACTIVATION_ATTEMPTS,
  activationPollMs = ACTIVATION_POLL_MS,
} = {}) {
  const golden = argv.includes('--golden');
  const contractOnly = argv.includes('--contract');
  if (golden && argv.length !== 1) throw new Error('Usage: --golden doit être utilisé seul');
  if (contractOnly && argv.length !== 1) throw new Error('Usage: --contract doit être utilisé seul');

  if (contractOnly) {
    const contract = await observeSellerContract(client);
    let contractReady = true;
    try { assertThrough(contract.proof, 'P1'); } catch { contractReady = false; }
    return {
      environment: 'sandbox', mode: 'contract', contract_ready: contractReady,
      seeded: 0, offer_ids: [], contract_proof: summary(contract.proof), preparation: null, activations: [],
      accepted: 0, invalid: [], checks: [], imported: null,
      purchase_confirmed: false, notification_verified: false, invoice_verified: false,
    };
  }

  const importing = golden || argv.includes('--import');
  const preparing = golden || argv.includes('--prepare');
  const activating = golden || argv.includes('--activate');
  const count = golden ? 1 : seedCount(argv);
  const plainArgs = argv.filter(arg => !['--golden', '--contract', '--prepare', '--import', '--activate'].includes(arg) && !arg.startsWith('--seed='));
  if (count && plainArgs.length) throw new Error('Usage: --seed et OFFER_ID sont mutuellement exclusifs');

  // Golden is composition, never discovery. Prove conversation + P0/P1 before
  // creating a producer, draft offer, publication command or canonical import.
  const contract = golden ? await probeSellerContract(client) : null;

  const ids = count
    ? await seedOfferIds(count, client, env)
    : plainArgs.map(connector.offerId);
  if (!ids.length || ids.length > 100) {
    throw new Error('Usage: node scripts/allegro-sandbox-check.js --contract | [--prepare] [--activate] [--import] [--seed=1..3 | OFFER_ID ...] | --golden');
  }

  const preparation = preparing ? await prepareOfferIds(ids, client, contract?.settings || null) : null;
  const activations = activating
    ? await activateOfferIds(ids, client, { sleepImpl, attempts: activationAttempts, pollMs: activationPollMs })
    : [];

  const fetched = await fetchProducts({ productIds: ids });
  const checks = [];
  for (const product of fetched.products) {
    const unit = product.sellable_units[0];
    checks.push(await evaluate({ row: unit, identity: unit.supplier_order_identity, quantity: 1 }));
  }
  let imported = null;
  if (importing) {
    if (fetched.invalid.length || !fetched.products.length) throw new Error('ALLEGRO_IMPORT_REQUIRES_VALID_BATCH');
    const importer = importCatalog || require('../services/suppliers/catalog-import-orchestrator').importCatalog;
    imported = await importer({ source_type: 'api', supplier_id: 'allegro', supplier_name: 'Allegro Sandbox',
      product_ids: ids, is_full_snapshot: false }, null, async () => fetched);
  }
  const mode = golden ? 'golden' : importing ? (activating ? 'activate_import' : 'import') : (activating ? 'activate' : (preparing ? 'prepare' : 'read'));
  return { environment: 'sandbox', mode,
    contract_ready: contract ? true : null,
    seeded: count, offer_ids: ids, contract_proof: contract ? summary(contract.proof) : null, preparation, activations,
    accepted: fetched.products.length, invalid: fetched.invalid, checks, imported,
    purchase_confirmed: false, notification_verified: false, invoice_verified: false };
}

if (require.main === module) {
  run(process.argv.slice(2)).then(report => {
    console.log(JSON.stringify(report, null, 2));
    if ((report.mode === 'contract' && !report.contract_ready)
      || report.invalid.length || (report.mode !== 'contract' && !report.accepted)
      || (report.imported && (report.imported.status >= 400 || report.imported.body?.rejected > 0 || report.imported.body?.accepted === 0))) process.exitCode = 1;
  }).catch(error => { console.error(error.message); process.exitCode = 1; })
    .finally(async () => { await require('../db').pool.end(); process.exit(process.exitCode || 0); });
}
module.exports = {
  SEED_PREFIX, SEED_SEARCHES, SEED_PRICES, SEED_EXTERNAL_IDS, SEED_CANDIDATES_PER_SEARCH,
  seedCount, createdOfferId, seedOfferIds, sellerManagedShippingRate, eligibleReturnPolicy,
  buildSellerContractProof, observeSellerContract, probeSellerContract, selectSellerSettings, prepareOfferIds,
  sanitizedPublicationTasks, activateOfferIds, run,
};
