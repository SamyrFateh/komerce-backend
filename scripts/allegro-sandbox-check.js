/**
 * @komerce-arch
 * @role          allegro-sandbox-check
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        explicit sandbox offer IDs or guarded bounded sandbox seed, optional activation/import flags
 * @outputs       sanitized seller publication, catalog and purchasing evidence
 * @depends       services/suppliers/connectors/allegro-connector.js, services/suppliers/allegro-fulfillment-adapter.js, services/suppliers/catalog-import-orchestrator.js, services/suppliers/allegro-sandbox-client.js
 * @used-by       operator CLI
 * @db-read       supplier_oauth_connections
 * @db-write      supplier_oauth_connections; delegated canonical import writes when --import
 * @db-txn        delegated
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md
 * @impact-areas  catalog, purchasing
 */
'use strict';
const connector = require('../services/suppliers/connectors/allegro-connector');
const adapter = require('../services/suppliers/allegro-fulfillment-adapter');
const sandboxClient = require('../services/suppliers/allegro-sandbox-client');

const SEED_PREFIX = 'Komerce Sandbox Seed';
const SEED_SEARCHES = Object.freeze(['kabel usb', 'mysz bezprzewodowa', 'lampka led']);
const SEED_PRICES = Object.freeze([29.90, 49.90, 79.90]);
const SEED_EXTERNAL_IDS = Object.freeze(['komerce-sandbox-seed-1', 'komerce-sandbox-seed-2', 'komerce-sandbox-seed-3']);
const ACTIVATION_ATTEMPTS = 10;
const ACTIVATION_POLL_MS = 1000;

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
  const usedProducts = new Set();

  // Reuse the exact same drafts across retries. Allegro supports seller-offer
  // filtering by external.id, which is a much stronger identity than title text.
  for (let index = 0; index < count; index += 1) {
    const listed = await api.get('/sale/offers', { 'external.id': SEED_EXTERNAL_IDS[index] });
    const offer = (Array.isArray(listed?.offers) ? listed.offers : [])
      .find(row => String(row?.external?.id || '') === SEED_EXTERNAL_IDS[index]
        && /^[0-9]{1,30}$/.test(String(row?.id || '')));
    if (offer) ids[index] = String(offer.id);
  }

  for (let index = 0; index < count; index += 1) {
    if (ids[index]) continue;
    const phrase = SEED_SEARCHES[index];
    const found = await api.searchProducts(phrase, { limit: 10 });
    const products = Array.isArray(found?.products) ? found.products : [];
    const product = products.find(row => row?.id && !usedProducts.has(String(row.id)));
    if (!product) continue;
    usedProducts.add(String(product.id));
    const created = await api.createDraftOffer({
      productId: String(product.id),
      name: `${SEED_PREFIX} ${index + 1} - ${String(product.name || phrase)}`.slice(0, 75),
      externalId: SEED_EXTERNAL_IDS[index],
      pricePln: SEED_PRICES[index],
      stock: 10 + index,
    });
    ids[index] = createdOfferId(created);
  }

  const complete = ids.filter(Boolean);
  if (complete.length !== count) throw new Error(`ALLEGRO_SANDBOX_SEED_INCOMPLETE_${complete.length}_OF_${count}`);
  return ids;
}

function sanitizedPublicationTasks(payload) {
  return (Array.isArray(payload?.tasks) ? payload.tasks : []).slice(0, 20).map(task => ({
    offer_id: String(task?.offer?.id || task?.offerId || ''),
    status: task?.status ? String(task.status) : null,
    error_codes: (Array.isArray(task?.errors) ? task.errors : []).slice(0, 10)
      .map(error => String(error?.code || '')).filter(Boolean),
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
      throw new Error(`ALLEGRO_SANDBOX_ACTIVATION_NOT_ACTIVE_${id}_${publicationStatus}_${taskStatus}`);
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
  const importing = argv.includes('--import');
  const activating = argv.includes('--activate');
  const count = seedCount(argv);
  const plainArgs = argv.filter(arg => arg !== '--import' && arg !== '--activate' && !arg.startsWith('--seed='));
  if (count && plainArgs.length) throw new Error('Usage: --seed et OFFER_ID sont mutuellement exclusifs');
  const ids = count
    ? await seedOfferIds(count, client, env)
    : plainArgs.map(connector.offerId);
  if (!ids.length || ids.length > 100) throw new Error('Usage: node scripts/allegro-sandbox-check.js [--activate] [--import] [--seed=1..3 | OFFER_ID ...]');

  const activations = activating
    ? await activateOfferIds(ids, client, { sleepImpl, attempts: activationAttempts, pollMs: activationPollMs })
    : [];

  // Always re-read through the canonical connector after optional seller activation.
  // `--activate` is not considered successful merely because Allegro accepted the
  // command: the seller offer itself must have been observed ACTIVE first.
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
  const mode = importing ? (activating ? 'activate_import' : 'import') : (activating ? 'activate' : 'read');
  return { environment: 'sandbox', mode,
    seeded: count, offer_ids: ids, activations,
    accepted: fetched.products.length, invalid: fetched.invalid, checks, imported,
    purchase_confirmed: false, notification_verified: false, invoice_verified: false };
}

if (require.main === module) {
  run(process.argv.slice(2)).then(report => {
    console.log(JSON.stringify(report, null, 2));
    // A catalog connection check is not a successful purchase E2E.
    if (report.invalid.length || !report.accepted || (report.imported && (report.imported.status >= 400 || report.imported.body?.rejected > 0 || report.imported.body?.accepted === 0))) process.exitCode = 1;
  }).catch(error => { console.error(error.message); process.exitCode = 1; })
    .finally(async () => { await require('../db').pool.end(); process.exit(process.exitCode || 0); });
}
module.exports = {
  SEED_PREFIX, SEED_SEARCHES, SEED_PRICES, SEED_EXTERNAL_IDS,
  seedCount, createdOfferId, seedOfferIds, sanitizedPublicationTasks, activateOfferIds, run,
};