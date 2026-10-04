'use strict';

const fs = require('fs');
const path = require('path');
const {
  CERTIFICATION_VERSION,
  REQUIRED_SCENARIOS,
  EXPLICITLY_UNPROVEN,
} = require('../services/supplier-execution-certification');

function fail(message) {
  console.error('SUPPLIER_EXECUTION_CERTIFICATION_INVALID: ' + message);
  process.exitCode = 1;
}

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(
  path.join(root, 'config/supplier-execution-certification-manifest.json'),
  'utf8'
));

if (manifest.contract !== 'komerce-supplier-execution-certification-v1') fail('contract drift');
if (manifest.gate?.gate !== 'SUPPLIER_EXECUTION_CERTIFIED') fail('gate name drift');
if (manifest.gate?.version !== CERTIFICATION_VERSION) fail('version drift: manifest=' + manifest.gate?.version + ' code=' + CERTIFICATION_VERSION);
if (manifest.gate?.required !== REQUIRED_SCENARIOS.length) fail('scenario count drift: manifest=' + manifest.gate?.required + ' code=' + REQUIRED_SCENARIOS.length);
if (JSON.stringify(manifest.explicitly_unproven) !== JSON.stringify(EXPLICITLY_UNPROVEN)) fail('explicitly_unproven drift');

const matrix = fs.readFileSync(path.join(root, manifest.gate.proof_matrix), 'utf8');
for (const id of REQUIRED_SCENARIOS) {
  if (!matrix.includes('`' + id + '`')) fail('proof matrix missing scenario ' + id);
}
const realCount = (matrix.match(/\|\s*REAL\s*\|/g) || []).length;
if (realCount !== REQUIRED_SCENARIOS.length) fail('proof matrix incomplete: REAL=' + realCount + ' required=' + REQUIRED_SCENARIOS.length);

if (!process.exitCode) {
  console.log(JSON.stringify({
    contract: manifest.contract,
    gate: manifest.gate.gate,
    pass: true,
    required_scenarios: REQUIRED_SCENARIOS.length,
    explicitly_unproven: EXPLICITLY_UNPROVEN,
  }, null, 2));
}
