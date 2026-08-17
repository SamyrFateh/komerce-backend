'use strict';
const fs = require('fs');
const path = require('path');

const featureFileByName = new Map();
for (const file of fs.readdirSync('features').filter(f => f.endsWith('.feature.js'))) {
  const feature = require(path.resolve('features', file));
  if (feature && feature.name) featureFileByName.set(feature.name, `features/${file}`);
}

function addConsume(feature, target, text) {
  const p = featureFileByName.get(feature);
  if (!p) throw new Error(`manifest not found for ${feature}`);
  let src = fs.readFileSync(p, 'utf8');
  const contractPos = src.indexOf('contract:');
  const consumesPos = src.indexOf('consumes: [', contractPos);
  if (contractPos < 0 || consumesPos < 0) throw new Error(`contract.consumes missing for ${feature}`);
  const lineEnd = src.indexOf('\n', consumesPos);
  const firstLine = src.slice(consumesPos, lineEnd < 0 ? src.length : lineEnd);
  const multiEnd = src.indexOf('\n    ],', consumesPos);
  const blockEnd = multiEnd >= 0 ? multiEnd : (lineEnd < 0 ? src.length : lineEnd);
  const block = src.slice(consumesPos, blockEnd);
  const re = new RegExp(`['\"]${target}(?:\\s|\\(|['\"])`);
  if (re.test(block)) return;
  const entry = `${target} (${text})`;
  if (firstLine.includes('],')) {
    const close = src.indexOf(']', consumesPos);
    if (close < 0 || (lineEnd >= 0 && close > lineEnd)) throw new Error(`inline consumes close missing for ${feature}`);
    src = src.slice(0, close) + `, '${entry}'` + src.slice(close);
  } else {
    const openEnd = src.indexOf('\n', consumesPos) + 1;
    src = src.slice(0, openEnd) + `      '${entry}',\n` + src.slice(openEnd);
  }
  fs.writeFileSync(p, src);
}

// Real runtime contracts: O6 says business-dependency-declare-candidate or
// technical-dependency-policy, exceptionRequired=false.
addConsume('catalog', 'auth-identity', 'projection boutique b-greeting consomme /api/auth/me pour personnaliser la surface catalogue');
addConsume('documents', 'auth', 'gardes authenticate/requireAdmin sur les routes documents et factures');
addConsume('platform-ops', 'auth-identity', 'client API transversal et shell identité consomment les endpoints auth');
addConsume('platform-ops', 'catalog', 'shell/client API transversal monte et appelle les surfaces catalogue sans en posséder l’état');
addConsume('platform-ops', 'purchasing', 'client API transversal appelle le référentiel fournisseurs /api/purchasing/suppliers');
addConsume('shared-cart', 'recommendations', 'modal partagé consomme suggestions via interface /api/boutique/suggestions');

// O6 NON_RUNTIME_TEST is evidence about tests crossing features, not a runtime
// dependency contract. Keep it visible, but outside debt.
{
  const p = 'governance/business-graph-warning-semantics.js';
  let src = fs.readFileSync(p, 'utf8');
  const marker = `  if (\n    disposition.family === 'COMPOSITION_ROOT_WIRING' &&`;
  if (!src.includes(marker)) throw new Error('composition semantics marker missing');
  const insertion = `  if (\n    disposition.family === 'NON_RUNTIME_TEST' &&\n    disposition.evidenceRole === 'TEST_ONLY' &&\n    disposition.policy === 'non-runtime-evidence' &&\n    disposition.exceptionRequired === false\n  ) {\n    return {\n      category: 'EXPECTED_TOPOLOGY',\n      reason: 'O6 classe cette paire NON_RUNTIME_TEST : la seule preuve vient des tests et ne constitue pas une dépendance runtime à déclarer',\n    };\n  }\n\n`;
  src = src.replace(marker, insertion + marker);
  fs.writeFileSync(p, src);
}

// Regression test for NON_RUNTIME_TEST classification.
{
  const p = 'tests/unit/business-graph-warning-semantics.test.js';
  let src = fs.readFileSync(p, 'utf8');
  const end = src.lastIndexOf('\n});');
  if (end < 0) throw new Error('semantics test suite end missing');
  const test = `\n\n  it('classe une dépendance observée uniquement dans les tests hors dette runtime', () => {\n    const warning = { type: 'OBSERVED-UNDECLARED-FEATURE-DEPENDENCY', ref: 'inventory -> payments', msg: 'test-only' };\n    const pairClassifications = [{\n      from: 'inventory', to: 'payments', family: 'NON_RUNTIME_TEST',\n      evidenceRole: 'TEST_ONLY', policy: 'non-runtime-evidence', exceptionRequired: false,\n    }];\n    const p = semantics.partition([warning], { ROOT, pairClassifications });\n    expect(p.debt).toHaveLength(0);\n    expect(p.expectedTopology).toEqual([warning]);\n    expect(p.classified[0].semantic.category).toBe('EXPECTED_TOPOLOGY');\n  });`;
  src = src.slice(0, end) + test + src.slice(end);
  fs.writeFileSync(p, src);
}

// Tighten ratchet only after the six runtime declarations + six test-only
// semantic reclassifications are proven by regenerated graph.
{
  const p = 'governance/business-graph-drift-baseline.json';
  const baseline = JSON.parse(fs.readFileSync(p, 'utf8'));
  const key = 'OBSERVED-UNDECLARED-FEATURE-DEPENDENCY::ACTIONABLE_DRIFT';
  if (baseline.baseline[key] !== 16) throw new Error(`unexpected starting baseline ${key}=${baseline.baseline[key]}`);
  baseline.baseline[key] = 4;
  baseline._comment_test_only_contract_truth_20260817 = '6 dépendances test-only O6 NON_RUNTIME_TEST restent visibles en EXPECTED_TOPOLOGY ; 6 vrais contrats runtime sont déclarés. OBSERVED-UNDECLARED ACTIONABLE resserré 16→4, jamais relevé.';
  fs.writeFileSync(p, JSON.stringify(baseline, null, 2) + '\n');
}

console.log('Test-only semantics + six runtime contracts staged.');
