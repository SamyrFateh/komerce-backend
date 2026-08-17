'use strict';
const fs = require('fs');

function replaceOnce(file, from, to) {
  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes(from)) throw new Error(`marker missing in ${file}`);
  fs.writeFileSync(file, src.replace(from, to));
}

// Business Graph: classify all candidates internally, but only emit actual
// debt/drift through drifts.warn. Expected topology and tool limitations keep
// dedicated inventories and never masquerade as warnings again.
replaceOnce(
  'scripts/business-graph-gen.js',
  `    drifts: (() => {\n      const warn = warns.sort((a, b) => a.type.localeCompare(b.type) || String(a.ref).localeCompare(String(b.ref)));\n      const semantic = warningSemantics.partition(warn, { ROOT, pairClassifications: o6Dispositions.classifications });\n      return {\n        error: errors.sort((a, b) => a.type.localeCompare(b.type) || String(a.ref).localeCompare(String(b.ref))),\n        warn, // flux brut conservé pour compatibilité : tous les signaux non-error\n        debt: semantic.debt,\n        expectedTopology: semantic.expectedTopology,\n        generatorLimitations: semantic.generatorLimitations,\n        summary: semantic.summary,\n      };\n    })(),`,
  `    drifts: (() => {\n      const candidates = warns.sort((a, b) => a.type.localeCompare(b.type) || String(a.ref).localeCompare(String(b.ref)));\n      const semantic = warningSemantics.partition(candidates, { ROOT, pairClassifications: o6Dispositions.classifications });\n      return {\n        error: errors.sort((a, b) => a.type.localeCompare(b.type) || String(a.ref).localeCompare(String(b.ref))),\n        // Doctrine 2026-08-17 : un warning est une anomalie actionnable / dette,\n        // jamais une topologie attendue ni une preuve test-only. Les candidats\n        // restent classifiés ci-dessous et visibles dans leurs inventaires dédiés.\n        warn: semantic.debt,\n        debt: semantic.debt,\n        expectedTopology: semantic.expectedTopology,\n        generatorLimitations: semantic.generatorLimitations,\n        summary: {\n          signals: semantic.debt.length,\n          debt: semantic.debt.length,\n          expectedTopology: semantic.expectedTopology.length,\n          generatorLimitations: semantic.generatorLimitations.length,\n          classifiedCandidates: candidates.length,\n        },\n      };\n    })(),`
);

// Ratchet: consume the canonical debt stream directly. Never re-feed expected
// topology / tool limitations into warning semantics from drifts.warn.
replaceOnce(
  'scripts/business-graph-ratchet-check.js',
  `// ── 2. Compte uniquement la dette réelle par clé "TYPE::CATEGORY" ─────────\n// EXPECTED_TOPOLOGY et GENERATOR_LIMITATION restent visibles dans le graphe\n// mais ne consomment jamais un budget de dette.\nconst rawSignals = graph.drifts.warn || [];\nconst semanticCtx = { ROOT, pairClassifications: (graph.o6 && graph.o6.pairClassifications) || [] };\nconst partition = semantics.partition(rawSignals, semanticCtx);\nconst warns = partition.debt;`,
  `// ── 2. Compte uniquement la dette réelle par clé "TYPE::CATEGORY" ─────────\n// drifts.warn == drifts.debt par doctrine : aucune topologie attendue / preuve\n// test-only / limite générateur ne doit revenir dans le flux warning.\nconst warns = graph.drifts.debt || graph.drifts.warn || [];\nconst semanticCtx = { ROOT, pairClassifications: (graph.o6 && graph.o6.pairClassifications) || [] };`
);
replaceOnce(
  'scripts/business-graph-ratchet-check.js',
  `console.log(\`\\n\${C.dim}Dette/drift ratchetté : \${totalCurrent} (baseline totale \${totalBase}). Hors dette : \${partition.expectedTopology.length} topologie(s) attendue(s), \${partition.generatorLimitations.length} limite(s) générateur.\${C.r}\`);`,
  `console.log(\`\\n\${C.dim}Dette/drift ratchetté : \${totalCurrent} (baseline totale \${totalBase}). Hors warning : \${(graph.drifts.expectedTopology || []).length} topologie(s) attendue(s), \${(graph.drifts.generatorLimitations || []).length} limite(s) générateur.\${C.r}\`);`
);

// Permanent regression: warning stream must contain debt only.
fs.writeFileSync('tests/unit/business-graph-warning-stream.test.js', `'use strict';\n\n/** @test-kind unit @test-runner jest @test-requires none */\nconst graph = require('../../docs/BUSINESS_FEATURE_GRAPH.json');\n\ndescribe('Business Graph warning stream doctrine', () => {\n  test('drifts.warn contient uniquement la dette réelle', () => {\n    expect(graph.drifts.warn).toEqual(graph.drifts.debt);\n    expect(graph.drifts.summary.signals).toBe(graph.drifts.warn.length);\n    expect(graph.drifts.summary.debt).toBe(graph.drifts.debt.length);\n  });\n\n  test('topologies attendues et limites outil ne sont jamais reloggées comme warnings', () => {\n    const warningKeys = new Set((graph.drifts.warn || []).map(x => `${x.type}::${x.ref}`));\n    for (const item of graph.drifts.expectedTopology || []) {\n      expect(warningKeys.has(`${item.type}::${item.ref}`)).toBe(false);\n    }\n    for (const item of graph.drifts.generatorLimitations || []) {\n      expect(warningKeys.has(`${item.type}::${item.ref}`)).toBe(false);\n    }\n  });\n\n  test('le total classifié reste traçable sans polluer le flux warning', () => {\n    const s = graph.drifts.summary;\n    expect(s.classifiedCandidates).toBe(\n      graph.drifts.debt.length + graph.drifts.expectedTopology.length + graph.drifts.generatorLimitations.length\n    );\n  });\n});\n`);

console.log('No-noise warning stream staged.');
