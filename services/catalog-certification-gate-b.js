/**
 * @komerce-arch
 * @role          catalog-certification-gate-b
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        deterministic catalog refinery torture observations
 * @outputs       CATALOG_CERTIFIED gate verdict
 * @depends       services/pipeline-certification-scenario-core.js
 * @used-by       tests/unit/catalog-certification-gate-b.test.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SOURCING_CATALOG_PIPELINE_CERTIFICATION.md
 * @impact-areas  catalog, ci
 * @version       2026-09-v1
 */
'use strict';
const { certifyScenarioGate } = require('./pipeline-certification-scenario-core');
const VERSION='catalog-certified-gate-b-v1';
const REQUIRED_SCENARIOS=Object.freeze([
 'missing_or_invalid_price','unknown_currency','duplicate_sku','missing_primary_media',
 'malformed_media_url','absurd_dimensions_or_weight','missing_category','ambiguous_category',
 'taxonomy_change','contradictory_attributes','zero_variants','duplicate_variants',
 'product_update_after_acceptance','eligibility_exclusion','malformed_description_or_specs',
 'interrupted_refinery_batch'
]);
function certifyGateB(scenarios=[]){return certifyScenarioGate({gate:'CATALOG_CERTIFIED',version:VERSION,requiredScenarios:REQUIRED_SCENARIOS,scenarios});}
module.exports={GATE_B_VERSION:VERSION,REQUIRED_SCENARIOS,certifyGateB};
