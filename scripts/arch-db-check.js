'use strict';

/**
 * @komerce-arch
 * @role         governance-arch-db-check
 * @domain       governance
 * @layer        tooling
 * @criticality  high
 * @purpose      Porte d'hygiene structurelle des headers (graphe d'architecture).
 * @inputs       docs/komerce-arch-header-graph.json
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
 * Perimetre (post base-0, 2026-06-16 ; @depends/@used-by durcis 2026-07-07) :
 *   BLOQUANT (exit 1 hors --report) :
 *     - fichiers sans header
 *     - lite sans owner
 *     - mots-clefs SQL dans @db-read / @db-write
 *     - @unknown dans @depends / @used-by (voir note ci-dessous)
 *   OBSERVE (informatif, jamais bloquant) :
 *     - edges morts (structurel)
 *     - @unknown en @db-read/@db-write (SQL dynamique assume)
 *     - presence de l'invariant resolve_before_behavior_change (sain)
 *
 * Note 2026-07-07 (audit @unknown, 108 fichiers verifies) : contrairement a
 * @db-read/@db-write, ou une table peut etre construite dynamiquement
 * (`${tableName}`) et rester une incertitude legitime, les dependances de
 * module de ce repo sont TOUJOURS statiques (aucun require()/import
 * dynamique trouve sur l'ensemble des SCAN_ROOTS lors de l'audit). Un
 * @unknown en @depends/@used-by n'est donc jamais une incertitude assumee :
 * soit la resolution statique existe (require/import litteral, ou appelant
 * trouvable par grep) et le header aurait du la porter, soit elle est
 * verifiablement absente et la valeur correcte est "none" (comme @db-read/
 * @db-write none), jamais "@unknown". D'ou le passage au tier BLOQUANT.
 * Outillage : scripts/classify-unknown-depends.js (classification) +
 * scripts/fix-unknown-depends.js (application), rejouables si une regression
 * apparait.
 *
 * La juridiction des tables vs DB (fiction / fantome / non-documente) appartient a
 * scripts/arch-schema-drift-check.js, qui compare a docs/db/railway-live-schema.sql.
 *
 * Usage :
 *   node scripts/arch-db-check.js            # bloque sur le tier BLOQUANT
 *   node scripts/arch-db-check.js --report   # sort toujours en 0 (observation)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GRAPH_PATH = path.join(ROOT, 'docs', 'komerce-arch-header-graph.json');

const REPORT_ONLY = process.argv.includes('--report');

const SQL_NOISE = new Set([
  'select', 'insert', 'update', 'delete', 'set', 'from', 'where', 'into',
  'values', 'and', 'or', 'on', 'of', 'now', 'avg', 'sum', 'count', 'min',
  'max', 'lateral', 'rollback', 'commit', 'begin', 'returning', 'join',
  'left', 'right', 'inner', 'outer', 'full', 'cross', 'null', 'true', 'false',
  'distinct', 'group', 'order', 'limit', 'offset', 'union', 'with', 'case',
  'when', 'then', 'else', 'end', 'coalesce', 'exists', 'in', 'not', 'as',
  'using', 'having', 'asc', 'desc', 'by', 'all', 'any', 'between', 'like'
]);

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.cache', '.next', 'tmp', 'temp']);

function loadGraph() {
  if (!fs.existsSync(GRAPH_PATH)) {
    console.error('FATAL: docs/komerce-arch-header-graph.json absent.');
    console.error('       Lance d\'abord: node scripts/generate-komerce-arch-graph.js');
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf8'));
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

  const nodes = (graph.nodes || []).filter(n => n.type === 'file' || n.type === 'file-lite');

  // ---- BLOQUANT ----
  const noHeaders = graph.filesWithoutHeaders || [];
  const misplacedHeaders = graph.filesWithMisplacedHeaders || [];
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

  // @unknown en @depends / @used-by : toujours evitable dans ce repo (aucun
  // require()/import dynamique n'existe sur les SCAN_ROOTS), donc bloquant.
  // IMPORTANT : on relit le texte brut des fichiers, pas les tableaux
  // node.depends/node.usedBy du graphe -- splitList() y filtre deja le
  // token '@unknown' (il le traite comme "liste vide"), donc il serait
  // invisible si on ne regardait que le JSON deja parse.
  const dependsUsedByUnknownHits = [];
  for (const file of walk('.')) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    if (!(graph.scanRoots || []).some(r => rel === r || rel.startsWith(r + '/'))) continue;
    let txt;
    try { txt = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (/^\s*\*\s+@depends\s+@unknown\s*$/m.test(txt)) dependsUsedByUnknownHits.push(`${rel} [depends] -> @unknown`);
    if (/^\s*\*\s+@used-by\s+@unknown\s*$/m.test(txt)) dependsUsedByUnknownHits.push(`${rel} [used-by] -> @unknown`);
  }

  // ---- OBSERVE (informatif, jamais bloquant) ----
  // Note: la juridiction des tables (fiction / fantome / non-documente) appartient
  // desormais a scripts/arch-schema-drift-check.js, qui compare a la DB live.
  // Ce script ne garde QUE l'hygiene structurelle des headers (tier bloquant) +
  // quelques compteurs d'etat ci-dessous.
  const deadEdges = (graph.unresolvedCodeEdges || []).length;
  const unknownTokens = countUnknownTokens(graph.scanRoots);
  const doctrineTxnPresence = nodes
    .filter(n => (n.dbTxn || []).some(t => String(t) === 'resolve_before_behavior_change'))
    .length;

  // ---- Tier BLOQUANT : violations dures ----
  const hard = [];
  if (noHeaders.length > 0) {
    hard.push(`Fichiers sans header: ${noHeaders.length}\n  - ` + noHeaders.slice(0, 40).join('\n  - '));
  }
  if (misplacedHeaders.length > 0) {
    hard.push(`Headers @komerce-arch mal places (shebang/code avant le bloc /** */): ${misplacedHeaders.length}\n  Fix : shebang en ligne 1 -> header @komerce-arch juste apres -> 'use strict' apres le header.\n  - ` + misplacedHeaders.slice(0, 40).join('\n  - '));
  }
  if (liteNoOwner.length > 0) {
    hard.push(`Lite sans owner: ${liteNoOwner.length}\n  - ` + liteNoOwner.slice(0, 40).join('\n  - '));
  }
  if (noiseHits.length > 0) {
    hard.push(`Mots-clefs SQL dans @db-read/@db-write: ${noiseHits.length}\n  - ` + noiseHits.slice(0, 60).join('\n  - '));
  }
  if (dependsUsedByUnknownHits.length > 0) {
    hard.push(`@unknown dans @depends/@used-by (toujours evitable ici, cf note en tete de fichier): ${dependsUsedByUnknownHits.length}\n  - ` + dependsUsedByUnknownHits.slice(0, 60).join('\n  - '));
  }

  // ---- Rapport ----
  console.log('============================================================');
  console.log(' KOMERCE - Porte architecture / DB (hygiene headers)');
  console.log('============================================================');
  console.log(`Mode                    : ${REPORT_ONLY ? '--report (non bloquant)' : 'bloquant'}`);
  console.log(`Fichiers scannes        : ${graph.totals?.scannedCodeFiles ?? '?'}`);
  console.log(`Headers (full/lite)     : ${graph.totals?.filesWithFullHeaders ?? '?'} / ${graph.totals?.filesWithLiteHeaders ?? '?'}`);
  console.log('');
  console.log('--- TIER BLOQUANT ---');
  console.log(`Sans header             : ${noHeaders.length}`);
  console.log(`Header mal place        : ${misplacedHeaders.length}`);
  console.log(`Lite sans owner         : ${liteNoOwner.length}`);
  console.log(`Mots-clefs SQL          : ${noiseHits.length}`);
  console.log(`@unknown depends/used-by: ${dependsUsedByUnknownHits.length}`);
  console.log('');
  console.log('--- OBSERVE (informatif, jamais bloquant) ---');
  console.log(`Edges morts (structurel): ${deadEdges}`);
  console.log(`@unknown (SQL dynamique): ${unknownTokens}`);
  console.log(`Invariant txn present   : ${doctrineTxnPresence}  (presence doctrine = sain)`);
  console.log('Tables vs DB live        -> voir: node scripts/arch-schema-drift-check.js');
  console.log('');

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
