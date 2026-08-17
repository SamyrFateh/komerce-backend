'use strict';
const fs = require('fs');

function replaceOnce(path, from, to) {
  const src = fs.readFileSync(path, 'utf8');
  if (!src.includes(from)) throw new Error(`marker missing in ${path}: ${from.slice(0, 100)}`);
  fs.writeFileSync(path, src.replace(from, to));
}

// 1) Warning semantics: consume O6's already-computed disposition instead of
// counting application composition wiring as business dependency debt.
{
  const p = 'governance/business-graph-warning-semantics.js';
  let src = fs.readFileSync(p, 'utf8');
  const marker = '// ── Point d\'entrée ───────────────────────────────────────────────────────';
  if (!src.includes(marker)) throw new Error('warning semantics insertion marker missing');
  const fn = `function classifyObservedUndeclared(w, ctx) {\n  const pairClassifications = (ctx && ctx.pairClassifications) || [];\n  const ref = String(w.ref || '');\n  const arrow = ref.indexOf(' -> ');\n  if (arrow < 0) return null;\n  const from = ref.slice(0, arrow).trim();\n  const to = ref.slice(arrow + 4).trim();\n  const disposition = pairClassifications.find(p => p && p.from === from && p.to === to);\n  if (!disposition) return null;\n\n  if (\n    disposition.family === 'COMPOSITION_ROOT_WIRING' &&\n    disposition.policy === 'application-wiring-not-consumption' &&\n    disposition.exceptionRequired === false\n  ) {\n    return {\n      category: 'EXPECTED_TOPOLOGY',\n      reason: 'O6 classe cette paire COMPOSITION_ROOT_WIRING : le composition root monte/câble la feature sans la consommer comme dépendance métier (application-wiring-not-consumption, aucune exception requise)',\n    };\n  }\n  return null;\n}\n\n`;
  src = src.replace(marker, fn + marker);

  const switchMarker = `    case 'EXPOSED-ROUTE-UNRESOLVED':\n      result = classifyExposedRouteUnresolved(w);\n      break;`;
  const switchReplacement = `${switchMarker}\n    case 'OBSERVED-UNDECLARED-FEATURE-DEPENDENCY':\n      result = classifyObservedUndeclared(w, ctx);\n      break;`;
  if (!src.includes(switchMarker)) throw new Error('warning semantics switch marker missing');
  src = src.replace(switchMarker, switchReplacement);
  fs.writeFileSync(p, src);
}

// 2) Generator: pass the CURRENT O6 disposition model to semantics. Never read
// stale generated JSON from disk while generating.
replaceOnce(
  'scripts/business-graph-gen.js',
  `      const semantic = warningSemantics.partition(warn, { ROOT });`,
  `      const semantic = warningSemantics.partition(warn, { ROOT, pairClassifications: o6Dispositions.classifications });`
);

// 3) Ratchet: reuse the generated graph's O6 disposition instead of
// reclassifying the same raw warning with less context.
replaceOnce(
  'scripts/business-graph-ratchet-check.js',
  `const rawSignals = graph.drifts.warn || [];\nconst partition = semantics.partition(rawSignals, { ROOT });`,
  `const rawSignals = graph.drifts.warn || [];\nconst semanticCtx = { ROOT, pairClassifications: (graph.o6 && graph.o6.pairClassifications) || [] };\nconst partition = semantics.partition(rawSignals, semanticCtx);`
);
replaceOnce(
  'scripts/business-graph-ratchet-check.js',
  `  const { category } = semantics.classify(w, { ROOT });`,
  `  const { category } = semantics.classify(w, semanticCtx);`
);

// 4) Unit regressions: conservative by default; only the exact O6 disposition
// is reclassified.
{
  const p = 'tests/unit/business-graph-warning-semantics.test.js';
  let src = fs.readFileSync(p, 'utf8');
  const end = src.lastIndexOf('\n});');
  if (end < 0) throw new Error('test suite end marker missing');
  const tests = `\n\n  it('classe le wiring du composition root comme topologie attendue quand O6 le prouve', () => {\n    const warning = { type: 'OBSERVED-UNDECLARED-FEATURE-DEPENDENCY', ref: 'infrastructure -> auth-passkey', msg: 'observée sans consumes' };\n    const pairClassifications = [{\n      from: 'infrastructure', to: 'auth-passkey', family: 'COMPOSITION_ROOT_WIRING',\n      policy: 'application-wiring-not-consumption', exceptionRequired: false,\n    }];\n    const p = semantics.partition([warning], { ROOT, pairClassifications });\n    expect(p.debt).toHaveLength(0);\n    expect(p.expectedTopology).toEqual([warning]);\n    expect(p.classified[0].semantic.category).toBe('EXPECTED_TOPOLOGY');\n  });\n\n  it('garde OBSERVED-UNDECLARED en dette sans disposition O6 correspondante', () => {\n    const warning = { type: 'OBSERVED-UNDECLARED-FEATURE-DEPENDENCY', ref: 'orders -> shared-cart', msg: 'observée sans consumes' };\n    const p = semantics.partition([warning], { ROOT, pairClassifications: [] });\n    expect(p.debt).toEqual([warning]);\n    expect(p.classified[0].semantic.category).toBe('ACTIONABLE_DRIFT');\n  });\n\n  it('ne blanchit pas une paire O6 qui exige une exception ou une autre policy', () => {\n    const warning = { type: 'OBSERVED-UNDECLARED-FEATURE-DEPENDENCY', ref: 'infrastructure -> auth-passkey', msg: 'observée sans consumes' };\n    const pairClassifications = [{\n      from: 'infrastructure', to: 'auth-passkey', family: 'COMPOSITION_ROOT_WIRING',\n      policy: 'application-wiring-not-consumption', exceptionRequired: true,\n    }];\n    const p = semantics.partition([warning], { ROOT, pairClassifications });\n    expect(p.debt).toEqual([warning]);\n    expect(p.classified[0].semantic.category).toBe('ACTIONABLE_DRIFT');\n  });`;
  src = src.slice(0, end) + tests + src.slice(end);
  fs.writeFileSync(p, src);
}

// 5) Ratchet only tightens after the proven semantic correction.
{
  const p = 'governance/business-graph-drift-baseline.json';
  const baseline = JSON.parse(fs.readFileSync(p, 'utf8'));
  const key = 'OBSERVED-UNDECLARED-FEATURE-DEPENDENCY::ACTIONABLE_DRIFT';
  if (baseline.baseline[key] !== 39) throw new Error(`unexpected starting baseline ${key}=${baseline.baseline[key]}`);
  baseline.baseline[key] = 26;
  baseline._comment_composition_root_20260817 = '13 paires déjà qualifiées par O6 comme COMPOSITION_ROOT_WIRING / application-wiring-not-consumption / exceptionRequired=false sortent du compteur de dette et restent visibles en EXPECTED_TOPOLOGY. Baseline resserrée 39→26, jamais relevée.';
  fs.writeFileSync(p, JSON.stringify(baseline, null, 2) + '\n');
}

console.log('Composition-root warning semantics staged.');
