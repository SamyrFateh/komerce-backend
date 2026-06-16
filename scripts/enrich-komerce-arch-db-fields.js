'use strict';

/**
 * @komerce-arch
 * @role         governance-arch-db-enrich
 * @domain       governance
 * @layer        tooling
 * @criticality  medium
 * @purpose      Derive @db-read / @db-write des headers a partir des VRAIES
 *               requetes SQL du fichier (et non de commentaires, logs ou texte).
 * @inputs       fichiers sources avec header @komerce-arch
 * @outputs      headers @db-read / @db-write mis a jour (documentation seulement)
 * @depends      none
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     KOMERCE_ARCH_GRAPH_DOCTRINE, KOMERCE_DB_SCHEMA_DOCTRINE
 * @impact-areas governance
 *
 * Idempotent. Documentation-only : ne touche QUE le bloc de header, jamais le code.
 *
 * Regles d'extraction :
 *   - ne lit que le contenu des appels .query(...) et des templates tagges sql`...`
 *   - retire les commentaires SQL (-- et / * * /) AVANT extraction
 *   - ignore les mots-clefs SQL, les sous-requetes (FROM ( ...) et LATERAL
 *   - ne touche pas @db-txn (semantique transactionnelle = decision humaine)
 *   - ne pretend RIEN sur l'existence live d'une table (ne lit pas SCHEMA.md)
 *
 * Usage :
 *   node scripts/enrich-komerce-arch-db-fields.js            # dry-run (n'ecrit rien)
 *   node scripts/enrich-komerce-arch-db-fields.js --write    # applique
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WRITE = process.argv.includes('--write');

const SCAN_ROOTS = ['server.js', 'bootstrap', 'routes', 'services', 'middleware', 'utils', 'public/boutique/js'];
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.cache', '.next', 'tmp', 'temp']);
const EXT = /\.(js|cjs|mjs)$/;

const SQL_KEYWORDS = new Set([
  'select', 'insert', 'update', 'delete', 'set', 'from', 'where', 'into',
  'values', 'and', 'or', 'on', 'of', 'now', 'avg', 'sum', 'count', 'min',
  'max', 'lateral', 'rollback', 'commit', 'begin', 'returning', 'join',
  'left', 'right', 'inner', 'outer', 'full', 'cross', 'null', 'true', 'false',
  'distinct', 'group', 'order', 'limit', 'offset', 'union', 'with', 'case',
  'when', 'then', 'else', 'end', 'coalesce', 'exists', 'in', 'not', 'as',
  'using', 'having', 'asc', 'desc', 'by', 'all', 'any', 'between', 'like',
  'only', 'conflict', 'do', 'nothing', 'returning'
]);

function* walk(rel) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return;
  const stat = fs.statSync(full);
  if (stat.isFile()) { if (EXT.test(full)) yield rel.replace(/\\/g, '/'); return; }
  if (!stat.isDirectory()) return;
  for (const entry of fs.readdirSync(full)) {
    if (IGNORE_DIRS.has(entry)) continue;
    yield* walk(path.join(rel, entry));
  }
}

// Extrait le contenu SQL des appels .query(...) et templates sql`...`
function collectSqlStrings(src) {
  const out = [];
  const callRe = /(?:\.\s*query|sql)\s*(?:\(\s*)?(`[\s\S]*?`|'[^'\\]*(?:\\.[^'\\]*)*'|"[^"\\]*(?:\\.[^"\\]*)*")/g;
  let m;
  while ((m = callRe.exec(src)) !== null) {
    out.push(m[1].slice(1, -1));
  }
  return out;
}

// Retire les commentaires SQL a l'interieur d'une requete
function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

function isTable(token) {
  if (!token) return false;
  const t = token.toLowerCase();
  if (SQL_KEYWORDS.has(t)) return false;
  if (t.includes('$')) return false;
  return /^[a-z_][a-z0-9_]*$/.test(t);
}

function extractTables(src) {
  const read = new Set();
  const write = new Set();
  const tbl = '(?:[a-z_][a-z0-9_]*\\.)?([a-z_][a-z0-9_]*)';
  const patterns = [
    [new RegExp(`\\bfrom\\s+${tbl}`, 'gi'), read],
    [new RegExp(`\\bjoin\\s+${tbl}`, 'gi'), read],
    [new RegExp(`\\busing\\s+${tbl}`, 'gi'), read],
    [new RegExp(`\\binsert\\s+into\\s+${tbl}`, 'gi'), write],
    [new RegExp(`\\bupdate\\s+(?:only\\s+)?${tbl}`, 'gi'), write],
    [new RegExp(`\\bdelete\\s+from\\s+${tbl}`, 'gi'), write]
  ];

  // Noms de CTE / sous-requetes nommees (xxx AS ( ... )) : ce ne sont pas des tables.
  const cteNames = new Set();
  for (const sqlRaw of collectSqlStrings(src)) {
    const sql = stripSqlComments(sqlRaw);
    for (const m of sql.matchAll(/\b([a-z_][a-z0-9_]*)\s+as\s*\(/gi)) {
      cteNames.add(m[1].toLowerCase());
    }
  }

  for (const sqlRaw of collectSqlStrings(src)) {
    const sql = stripSqlComments(sqlRaw);
    for (const [re, set] of patterns) {
      let m;
      while ((m = re.exec(sql)) !== null) {
        const token = m[1];
        if (isTable(token) && !cteNames.has(token.toLowerCase())) set.add(token.toLowerCase());
      }
    }
  }
  return {
    read: Array.from(read).sort(),
    write: Array.from(write).sort()
  };
}

function getHeaderBlock(src) {
  const trimmed = src.replace(/^\uFEFF/, '');
  const start = trimmed.indexOf('/**');
  if (start < 0) return null;
  const end = trimmed.indexOf('*/', start);
  if (end < 0) return null;
  const block = trimmed.slice(start, end + 2);
  if (!block.includes('@komerce-arch')) return null;
  return { block, start, end: end + 2 };
}

function setField(block, field, value) {
  const re = new RegExp(`^(\\s*\\*\\s+@${field}\\s+).+$`, 'm');
  if (re.test(block)) return block.replace(re, `$1${value}`);
  // pas de champ existant : l'inserer apres @used-by ou @depends
  const anchor = /^(\s*\*\s+@(?:used-by|depends)\s+[^\n]*\n)/m;
  if (anchor.test(block)) {
    return block.replace(anchor, `$1 * @${field}      ${value}\n`);
  }
  return block;
}

function main() {
  const files = [];
  for (const root of SCAN_ROOTS) for (const f of walk(root)) files.push(f);
  files.sort();

  const results = [];
  for (const file of files) {
    const full = path.join(ROOT, file);
    const src = fs.readFileSync(full, 'utf8');
    const header = getHeaderBlock(src);
    if (!header) { results.push({ file, status: 'no-header' }); continue; }

    const { read, write } = extractTables(src);
    const readVal = read.length ? read.join(', ') : '@unknown';
    const writeVal = write.length ? write.join(', ') : '@unknown';

    let block = header.block;
    block = setField(block, 'db-read', readVal);
    block = setField(block, 'db-write', writeVal);

    if (block === header.block) { results.push({ file, status: 'unchanged', read: readVal, write: writeVal }); continue; }

    const next = src.slice(0, header.start) + block + src.slice(header.end);
    if (WRITE) fs.writeFileSync(full, next, 'utf8');
    results.push({ file, status: WRITE ? 'written' : 'would-write', read: readVal, write: writeVal });
  }

  const counts = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  console.log(WRITE ? '=== ENRICH (--write) ===' : '=== ENRICH (dry-run, --write pour appliquer) ===');
  console.log('Summary:', counts);
  return results;
}

if (require.main === module) main();
module.exports = { extractTables, collectSqlStrings, stripSqlComments, SQL_KEYWORDS };
