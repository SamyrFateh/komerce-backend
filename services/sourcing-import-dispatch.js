/**
 * @komerce-arch
 * @role          sourcing-import-connector-dispatch
 * @domain        catalog
 * @layer         service
 * @criticality   medium
 * @inputs        supplier_import_payload
 * @outputs       normalized_supplier_products, connector_catalog, source_automation_catalog
 * @depends       services/suppliers/connectors/csv-connector.js, services/suppliers/connectors/manual-connector.js, services/suppliers/connectors/noon-connector.js, services/suppliers/connectors/cj-connector.js, services/suppliers/connectors/aliexpress-connected-connector.js, services/suppliers/connectors/allegro-connector.js, services/suppliers/connectors/ebay-connector.js
 * @used-by       routes/sourcing-scanner.js, services/sourcing-workspace.js, services/sourcing-source-autopilot.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      single_connector_dispatch_authority, source_autopull_is_registry_metadata_not_provider_branching
 * @impact-areas  sourcing, supplier-import
 * @version       2026-09
 */

'use strict';

const csvConnector = require('./suppliers/connectors/csv-connector');
const manualConnector = require('./suppliers/connectors/manual-connector');
const noonModule = require('./suppliers/connectors/noon-connector');
const cjModule = require('./suppliers/connectors/cj-connector');
const aliexpressModule = require('./suppliers/connectors/aliexpress-connected-connector');
const allegroModule = require('./suppliers/connectors/allegro-connector');
const ebayModule = require('./suppliers/connectors/ebay-connector');

// `automation` is deliberately declarative. The autopilot runner never branches
// on provider names: adding a future source means registering a connector and
// its bounded pull defaults here, not editing the runner.
const CONNECTORS = Object.freeze({
  csv: { module: csvConnector, active: true, label: 'CSV import' },
  manual: { module: manualConnector, active: true, label: 'Saisie manuelle' },
  api: {
    noon: {
      module: noonModule,
      active: noonModule.IS_ACTIVE,
      label: 'Noon API',
      reason: noonModule.INACTIVE_REASON,
      supplierName: 'Noon',
      automation: null,
    },
    cj: {
      module: cjModule,
      active: cjModule.IS_ACTIVE,
      label: 'CJdropshipping API',
      reason: cjModule.INACTIVE_REASON,
      supplierName: 'CJdropshipping',
      automation: Object.freeze({ page: 1, size: 20, include_commandable_units: true }),
    },
    allegro: {
      supportsFullSnapshot: false,
      module: allegroModule,
      get active() { return allegroModule.IS_ACTIVE; },
      label: 'Allegro Sandbox (seller test offers)',
      get reason() { return allegroModule.INACTIVE_REASON; },
      supplierName: 'Allegro Sandbox',
      automation: Object.freeze({}),
    },
    ebay: {
      supportsFullSnapshot: false,
      module: ebayModule,
      get active() { return ebayModule.IS_ACTIVE; },
      label: 'eBay Sandbox Browse API',
      get reason() { return ebayModule.INACTIVE_REASON; },
      supplierName: 'eBay Sandbox',
      // P3 registration only: no unattended broad crawl until a bounded
      // automation policy is separately proved.
      automation: null,
    },
    aliexpress: {
      module: aliexpressModule,
      active: aliexpressModule.IS_ACTIVE,
      label: 'AliExpress Dropshipper API',
      reason: aliexpressModule.INACTIVE_REASON,
      supplierName: 'AliExpress',
      automation: Object.freeze({ page: 1, size: 20 }),
    },
  },
});

function connectorCatalog() {
  return {
    sources: [
      { type: 'csv', active: true, label: 'CSV import' },
      { type: 'manual', active: true, label: 'Saisie manuelle' },
    ],
    api_suppliers: Object.keys(CONNECTORS.api).map(supplier => ({
      supplier,
      active: CONNECTORS.api[supplier].active,
      label: CONNECTORS.api[supplier].label,
      reason: CONNECTORS.api[supplier].active ? null : CONNECTORS.api[supplier].reason,
    })),
  };
}

function sourceAutomationCatalog() {
  return Object.entries(CONNECTORS.api)
    .filter(([, entry]) => entry.automation)
    .map(([adapter, entry]) => ({
      adapter,
      supplier_name: entry.supplierName || entry.label || adapter,
      label: entry.label,
      connector_ready: Boolean(entry.active),
      reason: entry.active ? null : (entry.reason || 'connecteur inactif'),
      pull_options: { ...entry.automation },
      supports_full_snapshot: entry.supportsFullSnapshot !== false,
    }));
}

function sourceAutomationDescriptor(adapter) {
  const key = String(adapter || '').trim().toLowerCase();
  return sourceAutomationCatalog().find((entry) => entry.adapter === key) || null;
}

function apiConnectorOptions(body = {}) {
  return {
    productIds: body.product_ids,
    productUrl: body.product_url,
    feedName: body.feed_name,
    keyword: body.keyword ?? body.query,
    page: body.page,
    size: body.size ?? body.page_size,
    categoryId: body.category_id,
    countryCode: body.country_code,
    sort: body.sort,
    startWarehouseInventory: body.start_warehouse_inventory,
    verifiedWarehouse: body.verified_warehouse,
    includeCommandableUnits: body.include_commandable_units === true,
  };
}

async function dispatchToConnector(body = {}) {
  const sourceType = body.source_type || 'manual';
  if (sourceType === 'csv') {
    return csvConnector.fetchProducts({
      supplier_name: body.supplier_name,
      csv_text: body.csv_text,
      csv_mapping: body.csv_mapping,
    });
  }
  if (sourceType === 'manual') {
    return manualConnector.fetchProducts({
      supplier_name: body.supplier_name,
      items: body.items,
    });
  }
  if (sourceType === 'api') {
    const supplier = String(body.supplier_id || '').toLowerCase();
    const entry = CONNECTORS.api[supplier];
    if (!entry) throw new Error(`API non configurée : supplier "${supplier}" inconnu. Sources connues : ${Object.keys(CONNECTORS.api).join(', ')}`);
    if (entry.supportsFullSnapshot === false && body.is_full_snapshot) throw new Error('Ce connecteur borné ne permet pas un archivage full snapshot');
    if (!entry.active) throw new Error(`API non configurée : ${entry.reason || 'connecteur inactif'}`);
    if (!entry.module || typeof entry.module.fetchProducts !== 'function') {
      throw new Error(`API "${supplier}" déclarée mais non câblée. Voir api-connector.base.js.`);
    }

    // Le dispatch ne connaît pas la sémantique du fournisseur. Il transmet
    // uniquement une whitelist de capacités communes ; chaque connecteur décide
    // lesquelles il sait réellement interpréter.
    return entry.module.fetchProducts(apiConnectorOptions(body));
  }
  throw new Error(`source_type inconnu : "${sourceType}". Valeurs supportées : csv, manual, api.`);
}

module.exports = {
  CONNECTORS,
  connectorCatalog,
  sourceAutomationCatalog,
  sourceAutomationDescriptor,
  apiConnectorOptions,
  dispatchToConnector,
};
