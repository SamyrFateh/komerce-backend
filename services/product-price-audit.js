/**
 * @komerce-arch
 * @role          catalog-product-price-audit-boundary
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       services/economic-price-audit-service.js
 * @used-by       services/product-admin-service.js
 * @db-txn        caller_managed
 * @doctrine      writer_not_owner_campaign_2026_08
 * @impact-areas  catalog, economic-engine, pricing
 * @version       2026-08
 */

'use strict';

// Frontière catalog -> economic-engine.
//
// LOT2 WRITER-NOT-OWNER : catalog ne porte plus aucun SQL sur price_history.
// Le chemin historique reste stable pour product-admin-service.js, mais la
// capacité d'audit et l'écriture appartiennent à economic-engine.

module.exports = require('./economic-price-audit-service');
