/**
 * @komerce-arch
 * @role          sourcing-import-connector-dispatch
 * @domain        catalog
 * @layer         service
 * @criticality   medium
 * @inputs        supplier_import_payload
 * @outputs       normalized_supplier_products, connector_catalog
 * @depends       services/suppliers/connectors/csv-connector.js, services/suppliers/connectors/manual-connector.js, services/suppliers/connectors/noon-connector.js, services/suppliers/connectors/cj-connector.js
 * @used-by       routes/sourcing-scanner.js, services/sourcing-workspace.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      single_connector_dispatch_authority
 * @impact-areas  sourcing, supplier-import
 * @version       2026-09
 */

'use strict';

const csvConnector = require('./suppliers/connectors/csv-connector');
const manualConnector = require('./suppliers/connectors/manual-connector');
const noonModule = require('./suppliers/connectors/noon-connector');
const cjModule = require('./suppliers/connectors/cj-connector');

const CONNECTORS = Object.freeze({
  csv: { module: csvConnector, active: true, label: 'CSV import' },
  manual: { module: manualConnector, active: true, label: 'Saisie manuelle' },
  api: {
    noon: { module: noonModule, active: noonModule.IS_ACTIVE, label: 'Noon API', reason: noonModule.INACTIVE_REASON },
    cj: { module: cjModule, active: cjModule.IS_ACTIVE, label: 'CJdropshipping API', reason: cjModule.INACTIVE_REASON },
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
    if (!entry.active) throw new Error(`API non configurée : ${entry.reason || 'connecteur inactif'}`);
    if (!entry.module || typeof entry.module.fetchProducts !== 'function') {
      throw new Error(`API "${supplier}" déclarée mais non câblée. Voir api-connector.base.js.`);
    }
    return entry.module.fetchProducts({
      keyword: body.keyword ?? body.query,
      page: body.page,
      size: body.size ?? body.page_size,
      categoryId: body.category_id,
      countryCode: body.country_code,
      startWarehouseInventory: body.start_warehouse_inventory,
      verifiedWarehouse: body.verified_warehouse,
    });
  }
  throw new Error(`source_type inconnu : "${sourceType}". Valeurs supportées : csv, manual, api.`);
}

module.exports = {
  CONNECTORS,
  connectorCatalog,
  dispatchToConnector,
};
