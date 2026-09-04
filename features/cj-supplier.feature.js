/**
 * @komerce-arch
 * @role          cj-supplier-feature-map
 * @domain        catalog
 * @layer         feature
 * @criticality   low
 * @inputs        supplier_api_connector
 * @outputs       governance_feature_registration
 * @depends       services/suppliers/connectors/cj-connector.js, services/sourcing-import-dispatch.js
 * @used-by       architecture governance
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md
 * @impact-areas  catalog, sourcing, supplier-import
 * @version       2026-09
 */
'use strict';

module.exports = Object.freeze({
  id: 'catalog-cj-supplier',
  domain: 'catalog',
  status: 'ready-when-configured',
  files: [
    'services/suppliers/connectors/cj-connector.js',
    'services/sourcing-import-dispatch.js',
    'tests/unit/cj-connector.test.js',
    'tests/unit/sourcing-import-dispatch.test.js',
    'docs/CJ_CONNECTOR.md',
  ],
});
