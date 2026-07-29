#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          feature-first-conformance-runner
 * @domain        infrastructure
 * @layer         gate
 * @criticality   critical
 * @inputs        features/*.feature.js, capabilities/*.capability.js, arbre source
 * @outputs       scorecard Feature First, exit code
 * @depends       tests/governance/feature-first/lib/checks.js, tests/governance/feature-first/lib/feature-graph.js
 * @db-write      none
 * @db-read       none
 * @used-by       opérateurs locaux et CI après certification
 * @doctrine      feature_first, cliquet
 * @version       2026-07
 *
 * @brief  Étage STATIQUE de la suite de conformité Feature First.
 *
 * Pur node, aucune dépendance : tourne sans `npm ci`, donc utilisable en
 * pre-commit et dans n'importe quel job CI minimal. Le runner appelle directement `runAllChecks()` : une seule implémentation du verdict.
 *
 * Usage :
 *   node scripts/feature-first-conformance.js            → scorecard, exit 0
 *   node scripts/feature-first-conformance.js --strict    → exit 1 si un FAIL (CI)
 * *   node scripts/feature-first-conformance.js --facts     → dump du graphe, aucun verdict
 *   node scripts/feature-first-conformance.js --json      → sortie machine
 */
'use strict';

const path = require('path');
const LIB = path.join(__dirname, '..', 'tests', 'governance', 'feature-first', 'lib');
const { buildGraph, loadBaseline, pairsOf } = require(path.join(LIB, 'feature-graph'));
const { runAllChecks, PASS, FAIL, WARN } = require(path.join(LIB, 'checks'));

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const STRICT = has('--strict');
const FACTS = has('--facts');
const JSON_OUT = has('--json');

const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { g: s => `\x1b[32m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`, y: s => `\x1b[33m${s}\x1b[0m`, d: s => `\x1b[2m${s}\x1b[0m`, b: s => `\x1b[1m${s}\x1b[0m` }
  : { g: s => s, r: s => s, y: s => s, d: s => s, b: s => s };

const graph = buildGraph();

// ── --facts : la réalité, sans jugement ────────────────────────────────────
if (FACTS) {
  const undeclared = pairsOf(graph.classified.undeclared);
  const facts = {
    manifests: { features: graph.features.length, capabilities: graph.capabilities.length, brokenLoad: graph.manifests.length - graph.valid.length },
    ownership: { declared: graph.ownership.size, auditableOnDisk: graph.auditableOnDisk.length, orphans: graph.orphans, multiOwned: graph.multiOwned },
    edges: {
      total: graph.edges.length,
      declared: graph.classified.declared.length,
      compositionRootWiring: graph.classified.wiring.length,
      ambientToInfrastructure: graph.classified.ambient.length,
      undeclared: Object.fromEntries([...undeclared].map(([k, v]) => [k, v])),
    },
    data: { multiWriterTables: graph.multiWriterTables },
    routes: { mounted: graph.mounted.length },
  };
  process.stdout.write(`${JSON.stringify(facts, null, 2)}\n`);
  process.exit(0);
}

// Les cliquets ne sont PAS normatifs à ce stade (décision de gouvernance du
// 2026-07-29 : aucune baseline de référence avant arbitrage de l'ontologie).
// Sans fichier `ratchets.json`, la suite tourne en MODE RAPPORT — elle mesure
// et affiche, elle ne fige rien et ne bloque rien.
const baseline = loadBaseline();
const REPORT_ONLY = !baseline;

const results = runAllChecks(graph, baseline || {});
const failed = results.filter(r => r.status === FAIL);
const warned = results.filter(r => r.status === WARN);
const passed = results.filter(r => r.status === PASS);

if (JSON_OUT) {
  process.stdout.write(`${JSON.stringify({ summary: { total: results.length, pass: passed.length, warn: warned.length, fail: failed.length }, results }, null, 2)}\n`);
  process.exit(STRICT && failed.length ? 1 : 0);
}

const badge = s => (s === PASS ? C.g('✔ PASS') : s === WARN ? C.y('▲ WARN') : C.r('✘ FAIL'));

process.stdout.write('\n');
process.stdout.write(C.b('╔══════════════════════════════════════════════════════════════════════╗\n'));
process.stdout.write(C.b('║  CONFORMITÉ FEATURE FIRST — la doctrine, affirmée par des tests      ║\n'));
process.stdout.write(C.b('╚══════════════════════════════════════════════════════════════════════╝\n\n'));

let currentBlock = null;
for (const r of results) {
  if (r.block !== currentBlock) {
    currentBlock = r.block;
    process.stdout.write(`${C.b(`\n─── ${currentBlock} ${'─'.repeat(Math.max(0, 62 - currentBlock.length))}`)}\n`);
  }
  process.stdout.write(`  ${badge(r.status)}  ${C.d(r.id.padEnd(11))} ${r.title}\n`);
  process.stdout.write(`${C.d(`               ${r.kind} · ${r.detail}`)}\n`);
  if (r.status !== PASS && r.evidence && r.evidence.length) {
    r.evidence.slice(0, 8).forEach(e => process.stdout.write(C.d(`                 · ${e}\n`)));
    if (r.evidence.length > 8) process.stdout.write(C.d(`                 · … +${r.evidence.length - 8}\n`));
  }
}

process.stdout.write('\n');
process.stdout.write(`${C.b('  Scorecard')} : ${C.g(`${passed.length} PASS`)} · ${C.y(`${warned.length} WARN`)} · ${C.r(`${failed.length} FAIL`)}  (${results.length} contrats)\n`);
process.stdout.write(C.d(REPORT_ONLY
  ? '  MODE RAPPORT — aucun cliquet normatif. Les mesures ci-dessus décrivent, elles ne figent pas.\n'
  : `  Cliquets figés le ${baseline._frozenAt || '?'} — une hausse bloque, une baisse se re-fige.\n`));

if (failed.length) {
  process.stdout.write(`\n${C.r('  La doctrine Feature First est rompue sur les points ci-dessus.')}\n`);
} else if (warned.length) {
  process.stdout.write(`\n${C.y('  Doctrine tenue. Dette résorbée quelque part — re-figer avec `--save`.')}\n`);
} else {
  process.stdout.write(`\n${C.g('  Doctrine Feature First tenue sur les ${results.length} contrats.')}\n`);
}
process.stdout.write('\n');

process.exit(STRICT && failed.length ? 1 : 0);
