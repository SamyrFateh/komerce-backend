/**
 * @komerce-arch
 * @role          aliexpress-semantic-compatibility-adapter
 * @domain        catalog
 * @layer         tooling
 * @criticality   medium
 * @inputs        normalized supplier product, discovery query
 * @outputs       canonical provider-independent semantic relevance evidence
 * @depends       services/suppliers/discovery-semantic-relevance.js
 * @used-by       legacy AliExpress semantic tests/imports
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      provider_semantics_owned_by_canonical_supplier_service
 * @impact-areas  sourcing, catalog, supplier-integration, staging
 * @version       2026-09-compat-v1
 */
'use strict';

module.exports = require('../services/suppliers/discovery-semantic-relevance');
