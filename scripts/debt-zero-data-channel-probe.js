'use strict';

const fs = require('fs');
const cp = require('child_process');

function replaceOnce(path, from, to) {
  let s = fs.readFileSync(path, 'utf8');
  if (!s.includes(from)) throw new Error(`${path}: target not found: ${from.slice(0, 100)}`);
  s = s.replace(from, to);
  fs.writeFileSync(path, s);
}

const conf = 'scripts/lib/feature-dependency-conformance.js';
replaceOnce(conf,
  '// ─────────────────────────────────────────────────────────────────────────\n// 5. AGRÉGATION EN PAIRES + CLASSIFICATION DE CONFORMANCE',
`// ─────────────────────────────────────────────────────────────────────────
// 4b. CANAL DATA — projection de tableOwnership déjà gouverné
// ─────────────────────────────────────────────────────────────────────────
function scanDataChannel(tableOwnership) {
  const records = [];
  for (const [table, info] of Object.entries(tableOwnership || {})) {
    const providerFeature = info && info.lifecycleOwner;
    if (!providerFeature) continue;
    for (const consumerFeature of info.readers || []) {
      if (!consumerFeature || consumerFeature === providerFeature) continue;
      records.push({ consumerFeature, providerFeature, channel: 'data-read', table, mode: 'R' });
    }
    for (const writer of info.writers || []) {
      if (!writer || writer.technical) continue;
      const consumerFeature = writer.feature;
      if (!consumerFeature || consumerFeature === providerFeature) continue;
      records.push({ consumerFeature, providerFeature, channel: 'data-write', table, mode: writer.mode || 'W' });
    }
  }
  return records;
}

// ─────────────────────────────────────────────────────────────────────────
// 5. AGRÉGATION EN PAIRES + CLASSIFICATION DE CONFORMANCE`);
replaceOnce(conf,
  'function aggregate({ codeByFile, interfaceRecords, index, ontologyGapManifests, declaredPairs, resolveAbsToFileId }) {',
  'function aggregate({ codeByFile, interfaceRecords, dataRecords, index, ontologyGapManifests, declaredPairs, resolveAbsToFileId }) {');
replaceOnce(conf,
  '  // ── Classification de conformance par paire canonique ───────────────────',
`  // ── Canal DATA : ownership/read-write déjà résolu par O4 ───────────────
  for (const rec of dataRecords || []) {
    const consumerIdn = { kind: 'canonical-feature', id: rec.consumerFeature, scope: 'backend' };
    recordEvidence(consumerIdn, rec.providerFeature, rec.channel, { table: rec.table, mode: rec.mode });
  }

  // ── Classification de conformance par paire canonique ───────────────────`);
replaceOnce(conf,
  '  const declaredPairs = (ctx.consumesEdges || []).filter(e => e.resolved).map(e => ({ from: e.from, to: e.to }));',
  "  const dataRecords = scanDataChannel(ctx.tableOwnership || {});\n\n  const declaredPairs = (ctx.consumesEdges || []).filter(e => e.resolved).map(e => ({ from: e.from, to: e.to }));");
replaceOnce(conf,
  '    codeByFile, interfaceRecords, index, ontologyGapManifests, declaredPairs, resolveAbsToFileId,',
  '    codeByFile, interfaceRecords, dataRecords, index, ontologyGapManifests, declaredPairs, resolveAbsToFileId,');
replaceOnce(conf,
  '  scanInterfaceChannel,\n  buildBoutiqueModuleToFileId,',
  '  scanInterfaceChannel,\n  scanDataChannel,\n  buildBoutiqueModuleToFileId,');

const gen = 'scripts/business-graph-gen.js';
replaceOnce(gen,
  '    boutiqueManifestNodes, consumesEdges, ontologyGaps, metaGraph,\n    ROOT, DASH_ROOT, BOUTIQUE_ROOT,',
  '    boutiqueManifestNodes, consumesEdges, ontologyGaps, metaGraph, tableOwnership,\n    ROOT, DASH_ROOT, BOUTIQUE_ROOT,');

const disp = 'scripts/lib/feature-dependency-disposition.js';
replaceOnce(disp,
  '      evidenceFiles.push({ role, channel: c.channel, source: src, target: e.targetFile || null, endpoint: e.endpoint || null });',
  '      evidenceFiles.push({ role, channel: c.channel, source: src, target: e.targetFile || null, endpoint: e.endpoint || null, table: e.table || null });');
replaceOnce(disp,
  "  const hasStatic = shapeChannels.has('static-code');\n  const hasIface = shapeChannels.has('interface');",
  "  const hasStatic = shapeChannels.has('static-code');\n  const hasIface = shapeChannels.has('interface');\n  const hasData = shapeChannels.has('data-read') || shapeChannels.has('data-write');");
replaceOnce(disp,
  "  if (hasStatic && hasIface) couplingObserved = 'mixed';\n  else if (hasIface) couplingObserved = 'interface';",
  "  if (hasStatic && (hasIface || hasData)) couplingObserved = 'mixed';\n  else if (hasIface) couplingObserved = 'interface';\n  else if (hasData) couplingObserved = 'data';");
replaceOnce(disp,
`    const label = f.channel === 'interface'
      ? \`${'${f.source || \'(view)\'}'} -> ${'${f.endpoint}'}\`
      : \`${'${f.source}'} -> ${'${f.target}'}\`;`,
`    const label = f.channel === 'interface'
      ? \`${'${f.source || \'(view)\'}'} -> ${'${f.endpoint}'}\`
      : (f.channel === 'data-read' || f.channel === 'data-write')
        ? \`${'${f.channel}'}:${'${f.table}'}\`
        : \`${'${f.source}'} -> ${'${f.target}'}\`;`);

const { scanDataChannel } = require('./lib/feature-dependency-conformance');
const rows = scanDataChannel({
  products: {
    lifecycleOwner: 'catalog',
    readers: ['orders'],
    writers: [
      { feature: 'catalog', mode: 'RW', technical: false },
      { feature: 'dashboard', mode: 'RW', technical: true },
      { feature: 'sourcing', mode: 'W', technical: false },
    ],
  },
});
const keys = rows.map(r => `${r.consumerFeature}->${r.providerFeature}:${r.channel}:${r.table}`).sort();
if (!keys.includes('orders->catalog:data-read:products')) throw new Error('reader missing');
if (!keys.includes('sourcing->catalog:data-write:products')) throw new Error('business writer missing');
if (keys.some(k => k.startsWith('dashboard->'))) throw new Error('technical writer leaked');
console.log('DATA_CHANNEL_UNIT', keys);

cp.execFileSync(process.execPath, ['scripts/business-graph-gen.js'], { stdio: 'inherit' });
const g = JSON.parse(fs.readFileSync('docs/BUSINESS_FEATURE_GRAPH.json', 'utf8'));
const dataPairs = g.o5.pairs.filter(p => p.channels.some(c => c.channel === 'data-read' || c.channel === 'data-write'));
const undeclared = dataPairs.filter(p => p.conformanceStatus === 'OBSERVED_UNDECLARED');
console.log('DATA_PAIRS', dataPairs.length);
console.log('DATA_UNDECLARED', undeclared.length);
for (const p of undeclared) console.log('DATA_DEBT', `${p.from}->${p.to}`, JSON.stringify(p.channels.filter(c => c.channel.startsWith('data-'))));
console.log('GRAPH_DRIFTS', JSON.stringify(g.drifts.summary));
console.log('O6_UNCLASSIFIED', JSON.stringify(g.o6.unclassified));
console.log('O6_MISSING_EXCEPTIONS', JSON.stringify(g.o6.missingExceptions));

cp.execFileSync(process.execPath, ['scripts/gen-feature-360.js'], { stdio: 'inherit' });
const f = JSON.parse(fs.readFileSync('docs/FEATURE_360.json', 'utf8'));
console.log('FEATURE360', JSON.stringify(f.summary));
for (const x of f.features.filter(x => x.architecturalDebt.debtCount)) {
  console.log('F360_DEBT', x.id, JSON.stringify(x.architecturalDebt.debtItems));
}
