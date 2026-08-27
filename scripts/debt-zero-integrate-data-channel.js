'use strict';

const fs = require('fs');

function replaceOnce(file, from, to) {
  let text = fs.readFileSync(file, 'utf8');
  if (!text.includes(from)) throw new Error(`${file}: target not found: ${from.slice(0, 140)}`);
  text = text.replace(from, to);
  fs.writeFileSync(file, text);
}

const conf = 'scripts/lib/feature-dependency-conformance.js';
replaceOnce(
  conf,
  '// ─────────────────────────────────────────────────────────────────────────\n// 5. AGRÉGATION EN PAIRES + CLASSIFICATION DE CONFORMANCE',
  `// ─────────────────────────────────────────────────────────────────────────\n// 4b. CANAL DATA — projection du tableOwnership déjà gouverné par O4\n// ─────────────────────────────────────────────────────────────────────────\n// Une lecture cross-feature et une écriture métier cross-feature sont des\n// dépendances observables. Les writers explicitement marqués technical (~)\n// restent exclus : reset/seed/simulation ne deviennent jamais des dépendances\n// métier par simple effet de bord d'outillage.\nfunction scanDataChannel(tableOwnership) {\n  const records = [];\n  for (const [table, info] of Object.entries(tableOwnership || {})) {\n    const providerFeature = info && info.lifecycleOwner;\n    if (!providerFeature) continue;\n\n    for (const consumerFeature of info.readers || []) {\n      if (!consumerFeature || consumerFeature === providerFeature) continue;\n      records.push({ consumerFeature, providerFeature, channel: 'data-read', table, mode: 'R' });\n    }\n\n    for (const writer of info.writers || []) {\n      if (!writer || writer.technical) continue;\n      const consumerFeature = writer.feature;\n      if (!consumerFeature || consumerFeature === providerFeature) continue;\n      records.push({ consumerFeature, providerFeature, channel: 'data-write', table, mode: writer.mode || 'W' });\n    }\n  }\n  return records;\n}\n\n// ─────────────────────────────────────────────────────────────────────────\n// 5. AGRÉGATION EN PAIRES + CLASSIFICATION DE CONFORMANCE`
);
replaceOnce(
  conf,
  'function aggregate({ codeByFile, interfaceRecords, index, ontologyGapManifests, declaredPairs, resolveAbsToFileId }) {',
  'function aggregate({ codeByFile, interfaceRecords, dataRecords, index, ontologyGapManifests, declaredPairs, resolveAbsToFileId }) {'
);
replaceOnce(
  conf,
  '  // ── Classification de conformance par paire canonique ───────────────────',
  `  // ── Canal DATA : ownership/read-write déjà résolu par O4 ───────────────\n  for (const rec of dataRecords || []) {\n    const consumerIdn = { kind: 'canonical-feature', id: rec.consumerFeature, scope: 'backend' };\n    recordEvidence(consumerIdn, rec.providerFeature, rec.channel, { table: rec.table, mode: rec.mode });\n  }\n\n  // ── Classification de conformance par paire canonique ───────────────────`
);
replaceOnce(
  conf,
  '  const declaredPairs = (ctx.consumesEdges || []).filter(e => e.resolved).map(e => ({ from: e.from, to: e.to }));',
  `  const dataRecords = scanDataChannel(ctx.tableOwnership || {});\n\n  const declaredPairs = (ctx.consumesEdges || []).filter(e => e.resolved).map(e => ({ from: e.from, to: e.to }));`
);
replaceOnce(
  conf,
  '    codeByFile, interfaceRecords, index, ontologyGapManifests, declaredPairs, resolveAbsToFileId,',
  '    codeByFile, interfaceRecords, dataRecords, index, ontologyGapManifests, declaredPairs, resolveAbsToFileId,'
);
replaceOnce(
  conf,
  '  scanInterfaceChannel,\n  buildBoutiqueModuleToFileId,',
  '  scanInterfaceChannel,\n  scanDataChannel,\n  buildBoutiqueModuleToFileId,'
);

const gen = 'scripts/business-graph-gen.js';
replaceOnce(
  gen,
  '    boutiqueManifestNodes, consumesEdges, ontologyGaps, metaGraph,\n    ROOT, DASH_ROOT, BOUTIQUE_ROOT,',
  '    boutiqueManifestNodes, consumesEdges, ontologyGaps, metaGraph, tableOwnership,\n    ROOT, DASH_ROOT, BOUTIQUE_ROOT,'
);
replaceOnce(
  gen,
  "'OBSERVED_CODE_DEPENDENCY', 'OBSERVED_INTERFACE_DEPENDENCY']",
  "'OBSERVED_CODE_DEPENDENCY', 'OBSERVED_INTERFACE_DEPENDENCY', 'OBSERVED_DATA_DEPENDENCY']"
);

const disp = 'scripts/lib/feature-dependency-disposition.js';
replaceOnce(
  disp,
  '      evidenceFiles.push({ role, channel: c.channel, source: src, target: e.targetFile || null, endpoint: e.endpoint || null });',
  '      evidenceFiles.push({ role, channel: c.channel, source: src, target: e.targetFile || null, endpoint: e.endpoint || null, table: e.table || null });'
);
replaceOnce(
  disp,
  "  const hasStatic = shapeChannels.has('static-code');\n  const hasIface = shapeChannels.has('interface');",
  "  const hasStatic = shapeChannels.has('static-code');\n  const hasIface = shapeChannels.has('interface');\n  const hasData = shapeChannels.has('data-read') || shapeChannels.has('data-write');"
);
replaceOnce(
  disp,
  "  if (hasStatic && hasIface) couplingObserved = 'mixed';\n  else if (hasIface) couplingObserved = 'interface';",
  "  if (hasStatic && (hasIface || hasData)) couplingObserved = 'mixed';\n  else if (hasIface) couplingObserved = 'interface';\n  else if (hasData) couplingObserved = 'data';"
);
replaceOnce(
  disp,
  "    const label = f.channel === 'interface'\n      ? `${f.source || '(view)'} -> ${f.endpoint}`\n      : `${f.source} -> ${f.target}`;",
  "    const label = f.channel === 'interface'\n      ? `${f.source || '(view)'} -> ${f.endpoint}`\n      : (f.channel === 'data-read' || f.channel === 'data-write')\n        ? `${f.channel}:${f.table}`\n        : `${f.source} -> ${f.target}`;"
);

const testPath = 'tests/unit/feature-dependency-data-channel.test.js';
fs.writeFileSync(testPath, `'use strict';\n\nconst { scanDataChannel } = require('../../scripts/lib/feature-dependency-conformance');\n\ndescribe('O5 data dependency channel', () => {\n  test('projects business reads/writes and excludes technical writers', () => {\n    const rows = scanDataChannel({\n      products: {\n        lifecycleOwner: 'catalog',\n        readers: ['orders', 'catalog'],\n        writers: [\n          { feature: 'catalog', mode: 'RW', technical: false },\n          { feature: 'sourcing', mode: 'W', technical: false },\n          { feature: 'dashboard', mode: 'RW', technical: true },\n        ],\n      },\n    });\n\n    expect(rows).toEqual(expect.arrayContaining([\n      expect.objectContaining({ consumerFeature: 'orders', providerFeature: 'catalog', channel: 'data-read', table: 'products' }),\n      expect.objectContaining({ consumerFeature: 'sourcing', providerFeature: 'catalog', channel: 'data-write', table: 'products' }),\n    ]));\n    expect(rows.some(row => row.consumerFeature === 'dashboard')).toBe(false);\n    expect(rows.some(row => row.consumerFeature === row.providerFeature)).toBe(false);\n  });\n});\n`);

console.log('Debt Zero: O5 data channel integrated');
