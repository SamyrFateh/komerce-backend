'use strict';
const fs = require('fs');

function read(file) { return fs.readFileSync(file, 'utf8'); }
function write(file, content) { fs.writeFileSync(file, content, 'utf8'); }
function replaceOnce(content, from, to, file) {
  const count = content.split(from).length - 1;
  if (count !== 1) throw new Error(`${file}: expected one match, got ${count}: ${from.slice(0, 100)}`);
  return content.replace(from, to);
}

// 1) Sémantique canonique : un seul helper partagé par générateur + ratchet.
const semanticsFile = 'governance/business-graph-warning-semantics.js';
let semantics = read(semanticsFile);
semantics = replaceOnce(
  semantics,
  'module.exports = { classify, DEFAULT_BY_TYPE };',
  `const DEBT_CATEGORIES = Object.freeze([\n  'INVALID_DECLARATION',\n  'ACTIONABLE_DRIFT',\n  'KNOWN_DEBT',\n]);\n\nfunction isDebtCategory(category) {\n  return DEBT_CATEGORIES.includes(category);\n}\n\nfunction partition(warnings, ctx) {\n  const out = {\n    debt: [],\n    expectedTopology: [],\n    generatorLimitations: [],\n    classified: [],\n  };\n  for (const warning of warnings || []) {\n    const semantic = classify(warning, ctx);\n    out.classified.push({ warning, semantic });\n    if (isDebtCategory(semantic.category)) out.debt.push(warning);\n    else if (semantic.category === 'EXPECTED_TOPOLOGY') out.expectedTopology.push(warning);\n    else if (semantic.category === 'GENERATOR_LIMITATION') out.generatorLimitations.push(warning);\n    else throw new Error('Catégorie de warning Business Graph inconnue: ' + semantic.category);\n  }\n  out.summary = {\n    signals: (warnings || []).length,\n    debt: out.debt.length,\n    expectedTopology: out.expectedTopology.length,\n    generatorLimitations: out.generatorLimitations.length,\n  };\n  return out;\n}\n\nmodule.exports = {\n  classify,\n  partition,\n  isDebtCategory,\n  DEBT_CATEGORIES,\n  DEFAULT_BY_TYPE,\n};`,
  semanticsFile
);
write(semanticsFile, semantics);

// 2) Business Graph : drifts.warn reste le flux brut compatible, mais debt/expected/limitations deviennent canoniques.
const graphFile = 'scripts/business-graph-gen.js';
let graph = read(graphFile);
graph = replaceOnce(
  graph,
  "const featureDependencyDisposition = require('./lib/feature-dependency-disposition');",
  "const featureDependencyDisposition = require('./lib/feature-dependency-disposition');\nconst warningSemantics = require('../governance/business-graph-warning-semantics.js');",
  graphFile
);
graph = replaceOnce(
  graph,
  `    drifts: {\n      error: errors.sort((a, b) => a.type.localeCompare(b.type) || String(a.ref).localeCompare(String(b.ref))),\n      warn: warns.sort((a, b) => a.type.localeCompare(b.type) || String(a.ref).localeCompare(String(b.ref))),\n    },`,
  `    drifts: (() => {\n      const warn = warns.sort((a, b) => a.type.localeCompare(b.type) || String(a.ref).localeCompare(String(b.ref)));\n      const semantic = warningSemantics.partition(warn, { ROOT });\n      return {\n        error: errors.sort((a, b) => a.type.localeCompare(b.type) || String(a.ref).localeCompare(String(b.ref))),\n        warn, // flux brut conservé pour compatibilité : tous les signaux non-error\n        debt: semantic.debt,\n        expectedTopology: semantic.expectedTopology,\n        generatorLimitations: semantic.generatorLimitations,\n        summary: semantic.summary,\n      };\n    })(),`,
  graphFile
);

const oldMd = `  L.push(\`### WARN / DEBT (\${model.drifts.warn.length})\`);\n  L.push('');\n  L.push('Classification sémantique Lot O4 Phase E — voir \`governance/business-graph-warning-semantics.js\`. Catégories : EXPECTED_TOPOLOGY (relation légitime documentée), KNOWN_DEBT (déclaration manquante, pas un défaut de comportement), ACTIONABLE_DRIFT (écart probable à corriger), INVALID_DECLARATION (nom de feature inexistant), GENERATOR_LIMITATION (artefact d\\'extraction).');\n  L.push('');\n  if (!model.drifts.warn.length) L.push('- none');\n  let warningSemantics = null;\n  try { warningSemantics = require('../governance/business-graph-warning-semantics.js'); } catch { /* module optionnel */ }\n  for (const d of model.drifts.warn) {\n    let tag = '';\n    if (warningSemantics) {\n      const { category } = warningSemantics.classify(d, { ROOT });\n      tag = \` _[\${category}]_\`;\n    }\n    L.push(\`- **[\${d.type}]**\${tag} \${d.ref} — \${d.msg}\`);\n  }\n  L.push('');`;
const newMd = `  L.push(\`### DETTE / DRIFT ACTIONNABLE (\${model.drifts.debt.length})\`);\n  L.push('');\n  L.push('Seules INVALID_DECLARATION, ACTIONABLE_DRIFT et KNOWN_DEBT constituent de la dette gouvernance. Les topologies attendues et limites du générateur restent visibles séparément et ne consomment aucun budget de dette.');\n  L.push('');\n  if (!model.drifts.debt.length) L.push('- none');\n  for (const d of model.drifts.debt) {\n    const { category } = warningSemantics.classify(d, { ROOT });\n    L.push(\`- **[\${d.type}]** _[\${category}]_ \${d.ref} — \${d.msg}\`);\n  }\n  L.push('');\n  L.push(\`### TOPOLOGIE ATTENDUE — hors dette (\${model.drifts.expectedTopology.length})\`);\n  L.push('');\n  if (!model.drifts.expectedTopology.length) L.push('- none');\n  for (const d of model.drifts.expectedTopology) L.push(\`- **[\${d.type}]** \${d.ref} — \${d.msg}\`);\n  L.push('');\n  L.push(\`### LIMITES DU GÉNÉRATEUR — hors dette (\${model.drifts.generatorLimitations.length})\`);\n  L.push('');\n  if (!model.drifts.generatorLimitations.length) L.push('- none');\n  for (const d of model.drifts.generatorLimitations) L.push(\`- **[\${d.type}]** \${d.ref} — \${d.msg}\`);\n  L.push('');`;
graph = replaceOnce(graph, oldMd, newMd, graphFile);

const oldCheck = `  const nErr = model.drifts.error.length;\n  const nWarn = model.drifts.warn.length;\n  console.log(\`\${C.bld}Business Feature Graph check\${C.r} — \${model.nodes.features.length} feature(s), \${nErr} error(s), \${nWarn} warn(s)\`);`;
const newCheck = `  const nErr = model.drifts.error.length;\n  const nDebt = model.drifts.debt.length;\n  const nExpected = model.drifts.expectedTopology.length;\n  const nLimitations = model.drifts.generatorLimitations.length;\n  console.log(\`\${C.bld}Business Feature Graph check\${C.r} — \${model.nodes.features.length} feature(s), \${nErr} error(s), \${nDebt} debt/drift, \${nExpected} expected, \${nLimitations} tool-limit\`);`;
graph = replaceOnce(graph, oldCheck, newCheck, graphFile);
graph = replaceOnce(
  graph,
  `  if (nWarn) {\n    console.log(\`\${C.ylw}▲ \${nWarn} avertissement(s) / dette visible (non bloquant) :\${C.r}\`);\n    model.drifts.warn.forEach(d => console.log(\`\${C.ylw}   [\${d.type}] \${d.ref} — \${d.msg}\${C.r}\`));\n  }`,
  `  if (nDebt) {\n    console.log(\`\${C.ylw}▲ \${nDebt} dette(s) / drift(s) réel(s) visible(s) (non bloquant) :\${C.r}\`);\n    model.drifts.debt.forEach(d => console.log(\`\${C.ylw}   [\${d.type}] \${d.ref} — \${d.msg}\${C.r}\`));\n  }\n  if (nExpected) console.log(\`\${C.dim}ℹ \${nExpected} topologie(s) attendue(s), hors dette.\${C.r}\`);\n  if (nLimitations) console.log(\`\${C.dim}ℹ \${nLimitations} limite(s) du générateur, hors dette.\${C.r}\`);`,
  graphFile
);
graph = replaceOnce(
  graph,
  "console.log(`${C.grn}${C.bld}✔ Business Feature Graph généré${C.r} — ${model.nodes.features.length} feature(s), ${model.drifts.error.length} error(s), ${model.drifts.warn.length} warn(s)`);",
  "console.log(`${C.grn}${C.bld}✔ Business Feature Graph généré${C.r} — ${model.nodes.features.length} feature(s), ${model.drifts.error.length} error(s), ${model.drifts.debt.length} debt/drift, ${model.drifts.expectedTopology.length} expected, ${model.drifts.generatorLimitations.length} tool-limit`);",
  graphFile
);
write(graphFile, graph);

// 3) Ratchet : seulement les catégories qui constituent réellement de la dette.
const ratchetFile = 'scripts/business-graph-ratchet-check.js';
let ratchet = read(ratchetFile);
ratchet = replaceOnce(
  ratchet,
  `// ── 2. Compte par clé "TYPE::CATEGORY" (Lot O4-2 point 2) ─────────────────\nconst warns = graph.drifts.warn || [];\nconst countByKey = {};   // "TYPE::CATEGORY" -> count\nconst typeOf = {};       // "TYPE::CATEGORY" -> TYPE (pour affichage groupé)\nconst categoryOf = {};   // "TYPE::CATEGORY" -> CATEGORY\nfor (const w of warns) {\n  const { category } = semantics.classify(w, { ROOT });\n  const key = \`\${w.type}::\${category}\`;\n  countByKey[key] = (countByKey[key] || 0) + 1;\n  typeOf[key] = w.type;\n  categoryOf[key] = category;\n}`,
  `// ── 2. Compte uniquement la dette réelle par clé "TYPE::CATEGORY" ─────────\n// EXPECTED_TOPOLOGY et GENERATOR_LIMITATION restent visibles dans le graphe\n// mais ne consomment jamais un budget de dette.\nconst rawSignals = graph.drifts.warn || [];\nconst partition = semantics.partition(rawSignals, { ROOT });\nconst warns = partition.debt;\nconst countByKey = {};   // "TYPE::CATEGORY" -> count\nconst typeOf = {};       // "TYPE::CATEGORY" -> TYPE (pour affichage groupé)\nconst categoryOf = {};   // "TYPE::CATEGORY" -> CATEGORY\nfor (const w of warns) {\n  const { category } = semantics.classify(w, { ROOT });\n  const key = \`\${w.type}::\${category}\`;\n  countByKey[key] = (countByKey[key] || 0) + 1;\n  typeOf[key] = w.type;\n  categoryOf[key] = category;\n}`,
  ratchetFile
);
ratchet = replaceOnce(
  ratchet,
  `const totalCurrent = warns.length;\nconst totalBase    = Object.values(baseline).reduce((a, b) => a + b, 0);\nconsole.log(\`\\n\${C.dim}Total warnings : \${totalCurrent} (baseline totale \${totalBase} — indicatif seulement, le ratchet raisonne par clé type::catégorie, jamais sur ce total)\${C.r}\`);`,
  `const totalCurrent = warns.length;\nconst totalBase    = Object.values(baseline).reduce((a, b) => a + b, 0);\nconsole.log(\`\\n\${C.dim}Dette/drift ratchetté : \${totalCurrent} (baseline totale \${totalBase}). Hors dette : \${partition.expectedTopology.length} topologie(s) attendue(s), \${partition.generatorLimitations.length} limite(s) générateur.\${C.r}\`);`,
  ratchetFile
);
write(ratchetFile, ratchet);

// 4) Nettoyage de vraies déclarations auth : 2 invalides + dépendances observées.
const authFile = 'features/auth.feature.js';
let auth = read(authFile);
auth = replaceOnce(
  auth,
  `    consumes: [\n      'notification',\n      'operations',\n      'orders',\n    ],`,
  `    consumes: [\n      'auth-identity',\n      'infrastructure',\n      'notifications',\n      'orders',\n    ],`,
  authFile
);
write(authFile, auth);

// 5) Baseline = seulement dette réelle ; resserrée aux niveaux attendus après correction auth.
const baselineFile = 'governance/business-graph-drift-baseline.json';
const baselineDoc = JSON.parse(read(baselineFile));
baselineDoc._comment_debt_truth_20260817 = 'Debt signal truth: seules INVALID_DECLARATION, ACTIONABLE_DRIFT et KNOWN_DEBT sont ratchettées. EXPECTED_TOPOLOGY et GENERATOR_LIMITATION restent visibles dans Business Graph mais sont hors dette et hors baseline. Baseline resserrée après correction auth, jamais augmentée.';
baselineDoc.generatedFrom = 'docs/BUSINESS_FEATURE_GRAPH.json::drifts.debt — baseline de dette réelle uniquement ; les signaux informatifs hors dette sont exclus du budget.';
baselineDoc.baseline = {
  'BOUTIQUE-FILE-MULTIPLE-OWNERS::ACTIONABLE_DRIFT': 0,
  'CONSUMES-REFERENCE-UNRESOLVED::INVALID_DECLARATION': 8,
  'EXPOSED-ROUTE-OWNER-MISMATCH::ACTIONABLE_DRIFT': 0,
  'EXPOSED-ROUTE-OWNER-MISMATCH::KNOWN_DEBT': 0,
  'EXPOSED-ROUTE-UNRESOLVED::ACTIONABLE_DRIFT': 0,
  'LOCAL-MANIFEST-DEPENDENCY-WITHOUT-CANONICAL-CONSUMER::KNOWN_DEBT': 0,
  'OBSERVED-UNDECLARED-FEATURE-DEPENDENCY::ACTIONABLE_DRIFT': 73,
  'WRITER-NOT-OWNER::ACTIONABLE_DRIFT': 1,
  'WRITER-NOT-OWNER::KNOWN_DEBT': 25
};
write(baselineFile, JSON.stringify(baselineDoc, null, 4) + '\n');

// 6) Régression permanente sur la sémantique du compteur de dette.
write('tests/unit/business-graph-warning-semantics.test.js', String.raw`'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const path = require('path');
const semantics = require('../../governance/business-graph-warning-semantics');
const ROOT = path.resolve(__dirname, '../..');

describe('Business Graph warning semantics — vérité de la dette', () => {
  it('ne compte jamais les limites du générateur comme dette', () => {
    const warnings = [{
      type: 'DYNAMIC-LOCAL-DEPENDENCY-UNRESOLVED',
      ref: 'scope:backend',
      msg: 'import dynamique non résolu',
    }];
    const p = semantics.partition(warnings, { ROOT });
    expect(p.debt).toHaveLength(0);
    expect(p.generatorLimitations).toHaveLength(1);
    expect(p.summary).toEqual({ signals: 1, debt: 0, expectedTopology: 0, generatorLimitations: 1 });
  });

  it('ne compte jamais une topologie attendue comme dette', () => {
    const warnings = [{
      type: 'DASH-MANIFEST-DUPLICATE-COPY',
      ref: 'admin-dashboard',
      msg: 'copie déclarée du canonique',
    }];
    const p = semantics.partition(warnings, { ROOT });
    expect(p.debt).toHaveLength(0);
    expect(p.expectedTopology).toHaveLength(1);
  });

  it('compte invalid declaration, actionable drift et known debt comme dette', () => {
    const warnings = [
      { type: 'CONSUMES-REFERENCE-UNRESOLVED', ref: 'auth -> "notification"', msg: 'nom inconnu' },
      { type: 'OBSERVED-UNDECLARED-FEATURE-DEPENDENCY', ref: 'a -> b', msg: 'observée sans consumes' },
      { type: 'WRITER-NOT-OWNER', ref: 'orders', msg: '2 écrivain(s) déclaré(s) (orders, logistics) sans owner de lifecycle univoque' },
    ];
    const p = semantics.partition(warnings, { ROOT });
    expect(p.debt).toHaveLength(3);
    expect(p.expectedTopology).toHaveLength(0);
    expect(p.generatorLimitations).toHaveLength(0);
    expect(p.classified.map(x => x.semantic.category)).toEqual([
      'INVALID_DECLARATION', 'ACTIONABLE_DRIFT', 'KNOWN_DEBT',
    ]);
  });
});
`);
