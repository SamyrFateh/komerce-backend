/**
 * @komerce-arch
 * @role          e2e-certification-gate-c
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        deterministic CJ and AliExpress full-pipeline observations
 * @outputs       E2E_CERTIFIED gate verdict
 * @depends       services/pipeline-certification-scenario-core.js
 * @used-by       tests/unit/pipeline-certification-gate-c.test.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SOURCING_CATALOG_PIPELINE_CERTIFICATION.md
 * @impact-areas  catalog, sourcing, ci
 * @version       2026-09-v1
 */
'use strict';
const { certifyScenarioGate } = require('./pipeline-certification-scenario-core');
const VERSION='e2e-certified-gate-c-v1';
const MODES=['identical_replay','reordered_payload','legitimate_update','malformed_update','interruption_resume','disappearance_return'];
const PROVIDERS=['CJ','AliExpress'];
const REQUIRED_SCENARIOS=Object.freeze(PROVIDERS.flatMap(p=>MODES.map(m=>`${p.toLowerCase()}__${m}`)));
function certifyGateC(scenarios=[]){return certifyScenarioGate({gate:'E2E_CERTIFIED',version:VERSION,requiredScenarios:REQUIRED_SCENARIOS,scenarios});}
module.exports={GATE_C_VERSION:VERSION,PROVIDERS,MODES,REQUIRED_SCENARIOS,certifyGateC};
