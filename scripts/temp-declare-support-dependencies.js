'use strict';
const fs = require('fs');
const path = require('path');

// decision-signals is intentionally NOT included: Business Graph observes it,
// but APP_FEATURE_REGISTRY has no canonical manifest for that feature name.
// We keep that seam visible as debt instead of inventing a declaration target.
const INFRA = [
  'auth-identity','catalog','customs','dashboard','documents','economic-engine',
  'incident-management','inventory','logistics','loyalty','notifications','orders','payments','platform-ops',
  'purchasing','recommendations','refunds','shared-cart','sourcing','unsold-resolution','wallet',
];
const OPS = ['auth-identity','catalog','notifications','orders','recommendations','shared-cart','wallet'];

const featureFileByName = new Map();
for (const file of fs.readdirSync('features').filter(f => f.endsWith('.feature.js'))) {
  const full = path.resolve('features', file);
  const feature = require(full);
  if (feature && feature.name) featureFileByName.set(feature.name, `features/${file}`);
}

function manifestPath(name) {
  const p = featureFileByName.get(name);
  if (!p) throw new Error(`manifest not found for exported feature name: ${name}`);
  return p;
}
function addConsume(feature, target, text) {
  const p = manifestPath(feature);
  let src = fs.readFileSync(p, 'utf8');
  const contractPos = src.indexOf('contract:');
  if (contractPos < 0) throw new Error(`contract block missing: ${feature} (${p})`);
  const consumesPos = src.indexOf('consumes: [', contractPos);
  if (consumesPos < 0) throw new Error(`contract.consumes missing: ${feature} (${p})`);
  const blockEnd = src.indexOf('\n    ],', consumesPos);
  if (blockEnd < 0) throw new Error(`contract.consumes end missing: ${feature} (${p})`);
  const block = src.slice(consumesPos, blockEnd);
  const re = new RegExp(`['\"]${target}(?:\\s|\\(|['\"])`);
  if (re.test(block)) return;
  const openEnd = src.indexOf('\n', consumesPos) + 1;
  src = src.slice(0, openEnd) + `      '${target} (${text})',\n` + src.slice(openEnd);
  fs.writeFileSync(p, src);
}

for (const feature of INFRA) {
  addConsume(feature, 'infrastructure', 'dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure');
}
for (const feature of OPS) {
  addConsume(feature, 'platform-ops', 'monitoring/exploitation transverse observé dans le code');
}

const baselinePath = 'governance/business-graph-drift-baseline.json';
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
baseline.baseline['OBSERVED-UNDECLARED-FEATURE-DEPENDENCY::ACTIONABLE_DRIFT'] = 39;
baseline._comment_support_deps_20260817 = 'Déclaration de 28 dépendances transversales réellement observées : 21 vers infrastructure et 7 vers platform-ops. decision-signals→infrastructure reste volontairement visible : le registre canonique ne fournit aucun manifest decision-signals où déclarer ce contrat. Aucun runtime modifié ; baseline uniquement resserrée de 67 à 39 après preuve générée.';
fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n');

console.log(`Staged ${INFRA.length + OPS.length} support dependency declarations across ${featureFileByName.size} discovered root feature manifests.`);
