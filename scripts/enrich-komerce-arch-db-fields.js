'use strict';

/**
 * @komerce-arch
 * @role         governance-arch-db-enrich
 * @domain       governance
 * @layer        tooling
 * @criticality  medium
 * @purpose      Derive @db-read / @db-write des headers a partir des VRAIES requetes
 *               SQL du fichier (fichier ENTIER, pas seulement les .query(...) inline).
 *               Utilise le meme noyau que la porte headers<->SQL : enrichisseur et
 *               controle ne peuvent donc plus diverger.
 * @inputs       scripts/lib/arch-drift-core.js, fichiers sources avec header @komerce-arch,
 *               docs/db/railway-live-schema.sql (ancrage)
 * @outputs      headers @db-read / @db-write completes (documentation seulement)
 * @depends      scripts/lib/arch-drift-core.js
 * @used-by      .github/workflows/enrich-komerce-arch-db-fields-once.yml
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     KOMERCE_ARCH_GRAPH_DOCTRINE, KOMERCE_DB_SCHEMA_DOCTRINE
 * @impact-areas governance
 *
 * Idempotent. Documentation-only : ne touche QUE le bloc de header, jamais le code.
 *
 * Regles :
 *   - scan du fichier entier (commentaires retires), via core.extractSqlTableRefsRW ;
 *   - ANCRAGE sur les tables live : seules de vraies tables sont ecrites (anti-bruit) ;
 *   - ADDITIF : fusionne avec les valeurs existantes, ne retire jamais une declaration
 *     manuelle (ex. table touchee uniquement en SQL dynamique) ;
 *   - n'INSERE JAMAIS un champ vide : si aucune vraie table n'est trouvee et qu'aucune
 *     n'etait declaree, le header n'est pas touche (pas de "@db-read @unknown" sur un
 *     fichier sans acces DB comme le front ou les utils ; "aucun acces" se note `none`) ;
 *   - ne touche pas @db-txn (semantique transactionnelle = decision humaine).
 *
 * Usage :
 *   node scripts/enrich-komerce-arch-db-fields.js            # dry-run (n'ecrit rien)
 *   node scripts/enrich-komerce-arch-db-fields.js --write    # applique
 */

const fs = require('fs');
const path = require('path');
const core = require('./lib/arch-drift-core');

const ROOT = path.resolve(__dirname, '..');
const WRITE = process.argv.includes('--write');

const SCAN_ROOTS = ['server.js', 'bootstrap', 'routes', 'services', 'middleware', 'utils', 'core', 'validators', 'public/boutique/js'];
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.cache', '.next', 'tmp', 'temp']);
const EXT = /\.(js|cjs|mjs)$/;

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

function getField(block, field) {
  const re = new RegExp(`^\\s*\\*\\s+@${field}\\s+(.+)$`, 'm');
  const m = block.match(re);
  if (!m) return [];
  return m[1].split(',').map(s => s.trim().toLowerCase())
    .filter(s => s && s !== '@unknown' && s !== 'none');
}

function setField(block, field, value) {
  const re = new RegExp(`^(\\s*\\*\\s+@${field}\\s+).+$`, 'm');
  if (re.test(block)) return block.replace(re, `$1${value}`);
  const anchor = /^(\s*\*\s+@(?:used-by|depends)\s+[^\n]*\n)/m;
  if (anchor.test(block)) return block.replace(anchor, `$1 * @${field}      ${value}\n`);
  return block;
}

function main() {
  let live;
  try {
    live = core.parseLiveSchema(fs.readFileSync(core.paths().liveSql, 'utf8')).tables;
  } catch (e) {
    console.error('FATAL: dump live illisible (docs/db/railway-live-schema.sql).', e.message);
    process.exit(2);
  }

  const files = [];
  for (const root of SCAN_ROOTS) for (const f of walk(root)) files.push(f);
  files.sort();

  const results = [];
  for (const file of files) {
    const full = path.join(ROOT, file);
    const src = fs.readFileSync(full, 'utf8');
    const header = getHeaderBlock(src);
    if (!header) { results.push({ file, status: 'no-header' }); continue; }

    // 1. extraction RW (fichier entier) ancree sur les tables live
    const { reads, writes } = core.extractSqlTableRefsRW(src);
    const liveReads = [...reads].filter(t => live.has(t));
    const liveWrites = [...writes].filter(t => live.has(t));

    // 2. fusion ADDITIVE avec l'existant (ne retire jamais une declaration manuelle)
    const mergedRead = [...new Set([...getField(header.block, 'db-read'), ...liveReads])].sort();
    const mergedWrite = [...new Set([...getField(header.block, 'db-write'), ...liveWrites])].sort();

    // 3. n'ecrire un champ QUE s'il y a du contenu reel a poser.
    //    Si rien n'est trouve et qu'aucune vraie table n'existait, on NE TOUCHE PAS le
    //    header : pas d'insertion de "@unknown" sur un fichier sans acces DB (front, utils).
    //    "aucun acces DB" (a documenter en `none` a la main) != "inconnu" (@unknown).
    let block = header.block;
    if (mergedRead.length) block = setField(block, 'db-read', mergedRead.join(', '));
    if (mergedWrite.length) block = setField(block, 'db-write', mergedWrite.join(', '));

    if (block === header.block) { results.push({ file, status: 'unchanged' }); continue; }

    const next = src.slice(0, header.start) + block + src.slice(header.end);
    if (WRITE) fs.writeFileSync(full, next, 'utf8');
    results.push({ file, status: WRITE ? 'written' : 'would-write' });
  }

  const counts = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  console.log(WRITE ? '=== ENRICH (--write) ===' : '=== ENRICH (dry-run, --write pour appliquer) ===');
  console.log('Summary:', counts);
  const changed = results.filter(r => r.status === 'would-write' || r.status === 'written');
  if (changed.length) {
    console.log('Fichiers ' + (WRITE ? 'modifies' : 'a modifier') + ' :');
    for (const r of changed) console.log('  ' + r.file);
  }
  return results;
}

if (require.main === module) main();
module.exports = { main };
