'use strict';

/**
 * @komerce-arch
 * @role         governance-arch-db-check
 * @domain       governance
 * @layer        tooling
 * @criticality  high
 * @purpose      Porte d'enforcement de la doctrine (blindage transition).
 * @inputs       docs/komerce-arch-header-graph.json, docs/SCHEMA.md, scripts/arch-debt-budget.json
 * @outputs      stdout report, process exit code
 * @depends      scripts/generate-komerce-arch-graph.js
 * @used-by      .github/workflows/governance.yml
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     KOMERCE_ARCH_GRAPH_DOCTRINE, KOMERCE_DB_SCHEMA_DOCTRINE
 * @impact-areas governance, ci
 *
 * Dependency-free. Ne modifie aucun comportement applicatif.
 *
 * Classification (blindage transition) :
 *   BLOQUANT (exit 1 hors --report) :
 *     - fichiers sans header
 *     - lite sans owner
 *     - mots-clefs SQL dans @db-read / @db-write
 *   DETTE (comptee + gelee via budget, jamais bloquante a ce stade) :
 *     - edges morts
 *     - tables hors SCHEMA.md
 *     - @unknown
 *     - @db-txn = resolve_before_behavior_change
 *
 * Usage :
 *   node scripts/arch-db-check.js            # bloque sur le tier BLOQUANT
 *   node scripts/arch-db-check.js --report   # transition : sort toujours en 0
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GRAPH_PATH = path.join(ROOT, 'docs', 'komerce-arch-header-graph.json');
const SCHEMA_PATH = path.join(ROOT, 'docs', 'SCHEMA.md');
const BUDGET_PATH = path.join(__dirname, 'arch-debt-budget.json');

const REPORT_ONLY = process.argv.includes('--report');

const SQL_NOISE = new Set([
  'select', 'insert', 'update', 'delete', 'set', 'from', 'where', 'into',
  'values', 'and', 'or', 'on', 'of', 'now', 'avg', 'sum', 'count', 'min',
  'max', 'lateral', 'rollback', 'commit', 'begin', 'returning', 'join',
  'left', 'right', 'inner', 'outer', 'full', 'cross', 'null', 'true', 'false',
  'distinct', 'group', 'order', 'limit', 'offset', 'union', 'with', 'case',
  'when', 'then', 'else', 'end', 'coalesce', 'exists', 'in', 'not', 'as',
  'using', 'having', 'asc', 'desc', 'by', 'all', 'any', 'between', 'like',
  'the', 'machine'
]);

const MONEY_RE = /(pricing|payment|paypal|stripe|refund|settlement|cash|invoice|wallet|cost|collective-payment|store[_-]credit|loyalty)/i;

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.cache', '.next', 'tmp', 'temp']);

function loadCanonicalDbObjects() {
  const md = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const names = new Set();
  for (const line of md.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const firstCell = trimmed.replace(/^\|/, '').split('|')[0].trim();
    const m = firstCell.match(/^`([a-z_][a-z0-9_]*)`$/);
    if (m) names.add(m[1].toLowerCase());
  }
  return names;
}

function loadGraph() {
  if (!fs.existsSync(GRAPH_PATH)) {
    console.error('FATAL: docs/komerce-arch-header-graph.json absent.');
    console.error('       Lance d\'abord: node scripts/generate-komerce-arch-graph.js');
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf8'));
}

function loadBudget() {
  const fallback = { deadEdges: Infinity, tablesOutsideSchema: Infinity, unknownTokens: Infinity, unresolvedMoneyTxn: Infinity };
  if (!fs.existsSync(BUDGET_PATH)) return fallback;
  try {
    return Object.assign(fallback, JSON.parse(fs.readFileSync(BUDGET_PATH, 'utf8')));
  } catch {
    return fallback;
  }
}

function* walk(p) {
  const full = path.join(ROOT, p);
  if (!fs.existsSync(full)) return;
  const stat = fs.statSync(full);
  if (stat.isFile()) {
    if (/\.(js|cjs|mjs)$/.test(full)) yield full;
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of fs.readdirSync(full)) {
    if (IGNORE_DIRS.has(entry)) continue;
    yield* walk(path.join(p, entry));
  }
}

function countUnknownTokens(scanRoots) {
  let count = 0;
  for (const root of scanRoots || []) {
    for (const file of walk(root)) {
      let txt;
      try { txt = fs.readFileSync(file, 'utf8'); } catch { continue; }
      const m = txt.match(/@unknown\b/g);
      if (m) count += m.length;
    }
  }
  return count;
}

function main() {
  const graph = loadGraph();
  const canonical = loadCanonicalDbObjects();
  const budget = loadBudget();

  const nodes = (graph.nodes || []).filter(n => n.type === 'file' || n.type === 'file-lite');

  // ---- BLOQUANT ----
  const noHeaders = graph.filesWithoutHeaders || [];
  const liteNoOwner = graph.liteWithoutOwner || [];

  const noiseHits = [];
  for (const node of nodes) {
    const tokens = [
      ...(node.dbRead || []).map(t => ['db-read', t]),
      ...(node.dbWrite || []).map(t => ['db-write', t])
    ];
    for (const [field, raw] of tokens) {
      const tok = String(raw).toLowerCase().trim();
      if (!tok || tok === '@unknown' || tok === 'resolve_before_behavior_change') continue;
      if (SQL_NOISE.has(tok)) noiseHits.push(`${node.file} [${field}] -> "${raw}"`);
    }
  }

  // ---- DETTE (comptee + gelee) ----
  const deadEdges = (graph.unresolvedCodeEdges || []).length;

  const outsideSchema = [];
  for (const node of nodes) {
    const tokens = [...(node.dbRead || []), ...(node.dbWrite || [])];
    for (const raw of tokens) {
      const tok = String(raw).toLowerCase().trim();
      if (!tok || tok === '@unknown' || tok === 'resolve_before_behavior_change') continue;
      if (SQL_NOISE.has(tok)) continue; // compte dans le tier BLOQUANT, pas ici
      if (!canonical.has(tok)) outsideSchema.push(`${node.file} -> "${raw}"`);
    }
  }

  const unknownTokens = countUnknownTokens(graph.scanRoots);

  const moneyUnresolved = nodes
    .filter(n => MONEY_RE.test(n.file))
    .filter(n => (n.dbTxn || []).some(t => String(t) === 'resolve_before_behavior_change'))
    .map(n => n.file)
    .sort();

  // ---- Tier BLOQUANT : violations dures ----
  const hard = [];
  if (noHeaders.length > 0) {
    hard.push(`Fichiers sans header: ${noHeaders.length}\n  - ` + noHeaders.slice(0, 40).join('\n  - '));
  }
  if (liteNoOwner.length > 0) {
    hard.push(`Lite sans owner: ${liteNoOwner.length}\n  - ` + liteNoOwner.slice(0, 40).join('\n  - '));
  }
  if (noiseHits.length > 0) {
    hard.push(`Mots-clefs SQL dans @db-read/@db-write: ${noiseHits.length}\n  - ` + noiseHits.slice(0, 60).join('\n  - '));
  }

  // ---- Rapport ----
  const debtLine = (label, current, max) => {
    const over = current > max;
    const tag = max === Infinity ? '(budget non defini)' : over ? `REGRESSION > budget ${max}` : `OK (<= budget ${max})`;
    return { label, current, max, over, str: `${label.padEnd(26)} : ${String(current).padStart(4)}   ${tag}` };
  };
  const debts = [
    debtLine('Edges morts', deadEdges, budget.deadEdges),
    debtLine('Tables hors SCHEMA.md', outsideSchema.length, budget.tablesOutsideSchema),
    debtLine('@unknown', unknownTokens, budget.unknownTokens),
    debtLine('Txn argent non resolue', moneyUnresolved.length, budget.unresolvedMoneyTxn)
  ];

  console.log('============================================================');
  console.log(' KOMERCE - Porte architecture / DB (blindage transition)');
  console.log('============================================================');
  console.log(`Mode                    : ${REPORT_ONLY ? '--report (non bloquant)' : 'bloquant'}`);
  console.log(`Fichiers scannes        : ${graph.totals?.scannedCodeFiles ?? '?'}`);
  console.log(`Headers (full/lite)     : ${graph.totals?.filesWithFullHeaders ?? '?'} / ${graph.totals?.filesWithLiteHeaders ?? '?'}`);
  console.log('');
  console.log('--- TIER BLOQUANT ---');
  console.log(`Sans header             : ${noHeaders.length}`);
  console.log(`Lite sans owner         : ${liteNoOwner.length}`);
  console.log(`Mots-clefs SQL          : ${noiseHits.length}`);
  console.log('');
  console.log('--- DETTE (gelee via budget, non bloquante) ---');
  for (const d of debts) console.log(d.str);
  console.log('');

  const regressions = debts.filter(d => d.over);
  if (regressions.length) {
    console.log('--- AVERTISSEMENTS DETTE (budget depasse) ---');
    for (const r of regressions) console.log(`⚠️  ${r.label}: ${r.current} > budget ${r.max} (a geler/baisser)`);
    console.log('');
  }

  if (hard.length) {
    console.log('--- VIOLATIONS BLOQUANTES ---');
    for (const v of hard) console.error('🚫 ' + v + '\n');
    console.log('============================================================');
    if (REPORT_ONLY) {
      console.log(`MODE --report : ${hard.length} violation(s) bloquante(s) detectee(s), sortie non bloquante.`);
      process.exit(0);
    }
    console.error(`ECHEC: ${hard.length} violation(s) bloquante(s).`);
    process.exit(1);
  }

  console.log('✅ Aucune violation du tier BLOQUANT.');
  process.exit(0);
}

main();
