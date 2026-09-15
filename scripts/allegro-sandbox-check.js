/**
 * @komerce-arch
 * @role          allegro-sandbox-check
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        explicit sandbox offer IDs or guarded bounded sandbox seed, optional import flag
 * @outputs       sanitized catalog and purchasing evidence
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
  const listed = await api.get('/sale/offers', { limit: 100, offset: 0 });
  const ids = (Array.isArray(listed?.offers) ? listed.offers : [])
    .filter(row => String(row?.name || '').startsWith(SEED_PREFIX))
    .map(row => String(row.id))
    .filter(id => /^[0-9]{1,30}$/.test(id))
    .slice(0, count);
  const usedProducts = new Set();

  for (const phrase of SEED_SEARCHES) {
    if (ids.length >= count) break;
    const found = await api.searchProducts(phrase, { limit: 10 });
    const products = Array.isArray(found?.products) ? found.products : [];
    const product = products.find(row => row?.id && !usedProducts.has(String(row.id)));
    if (!product) continue;
    usedProducts.add(String(product.id));
    const index = ids.length;
    const created = await api.createDraftOffer({
      productId: String(product.id),
      name: `${SEED_PREFIX} ${index + 1} - ${String(product.name || phrase)}`.slice(0, 75),
      pricePln: SEED_PRICES[index],
      stock: 10 + index,
    });
    ids.push(createdOfferId(created));
  }
  if (ids.length !== count) throw new Error(`ALLEGRO_SANDBOX_SEED_INCOMPLETE_${ids.length}_OF_${count}`);
  return ids;
}

async function run(argv, {
  fetchProducts = connector.fetchProducts,
  evaluate = adapter.evaluate,
  importCatalog,
  client = sandboxClient,
  env = process.env,
} = {}) {
  const importing = argv.includes('--import');
  const count = seedCount(argv);
  const plainArgs = argv.filter(arg => arg !== '--import' && !arg.startsWith('--seed='));
  if (count && plainArgs.length) throw new Error('Usage: --seed et OFFER_ID sont mutuellement exclusifs');
  const ids = count
    ? await seedOfferIds(count, client, env)
    : plainArgs.map(connector.offerId);
  if (!ids.length || ids.length > 100) throw new Error('Usage: node scripts/allegro-sandbox-check.js [--import] [--seed=1..3 | OFFER_ID ...]');

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
  return { environment: 'sandbox', mode: importing ? 'import' : 'read',
    seeded: count, offer_ids: ids,
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
module.exports = { SEED_PREFIX, SEED_SEARCHES, SEED_PRICES, seedCount, createdOfferId, seedOfferIds, run };
