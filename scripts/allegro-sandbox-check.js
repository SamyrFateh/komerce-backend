/**
 * @komerce-arch
 * @role          allegro-sandbox-check
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        explicit sandbox offer IDs, optional import flag
 * @outputs       sanitized catalog and purchasing evidence
 * @depends       services/suppliers/connectors/allegro-connector.js, services/suppliers/allegro-fulfillment-adapter.js, services/suppliers/catalog-import-orchestrator.js
 * @used-by       operator CLI
 * @db-read       none
 * @db-write      none
 * @db-txn        delegated
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md
 * @impact-areas  catalog, purchasing
 */
'use strict';
const connector = require('../services/suppliers/connectors/allegro-connector');
const adapter = require('../services/suppliers/allegro-fulfillment-adapter');

async function run(argv, { fetchProducts = connector.fetchProducts, evaluate = adapter.evaluate, importCatalog } = {}) {
  const importing = argv.includes('--import');
  const ids = argv.filter(arg => arg !== '--import').map(connector.offerId);
  if (!ids.length || ids.length > 100) throw new Error('Usage: node scripts/allegro-sandbox-check.js [--import] OFFER_ID ... (1..100)');
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
module.exports = { run };
