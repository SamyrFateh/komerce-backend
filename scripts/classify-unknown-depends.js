'use strict';
/**
 * Classifie chaque @unknown de @depends / @used-by en deux familles :
 *  - EVITABLE  : le require() est un littéral statique (chemin relatif en dur)
 *                et/ou des appelants internes sont trouvables par grep -> le
 *                header aurait pu être rempli, c'est de la paresse.
 *  - LEGITIME  : aucun require() interne statique (dépendances 100% externes/
 *                node builtin, ou require() dynamique via variable/template
 *                litteral) pour @depends ; ou aucun appelant interne trouvé
 *                pour @used-by (fichier jamais require() ailleurs dans le
 *                scan, típicamente un entrypoint monté par server.js/routes
 *                de façon indirecte, ou un fichier mort/isolé) -> incertitude
 *                assumée, pas de la paresse.
 *
 * Ne modifie rien. Sort un rapport JSON + texte.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_ROOTS = [
  'server.js', 'bootstrap', 'routes', 'services', 'middleware',
  'utils', 'core', 'validators', 'public/boutique/js'
];
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.cache', '.next', 'tmp', 'temp']);
const EXT = new Set(['.js', '.cjs', '.mjs']);

function walk(rel, out) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return;
  const st = fs.statSync(full);
  if (st.isFile()) { if (EXT.has(path.extname(full))) out.push(rel.replace(/\\/g, '/')); return; }
  if (!st.isDirectory()) return;
  for (const e of fs.readdirSync(full)) {
    if (IGNORE_DIRS.has(e)) continue;
    walk(path.join(rel, e), out);
  }
}

let allFiles = [];
for (const r of SCAN_ROOTS) walk(r, allFiles);
allFiles = [...new Set(allFiles)];

function readHeader(file) {
  const txt = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const m = txt.match(/\/\*\*[\s\S]*?@komerce-arch[\s\S]*?\*\//);
  if (!m) return null;
  const block = m[0];
  const fields = {};
  for (const line of block.split('\n')) {
    const fm = line.match(/^\s*\*\s+@(\S+)\s*(.*)$/);
    if (fm) fields[fm[1]] = fm[2].trim();
  }
  return { block, fields, txt };
}

// Static require() calls: require('literal') or require("literal")
// + import ... from 'literal' (frontend boutique en ESM)
const STATIC_REQ_RE = /(?:require\(\s*(['"])([^'"]+)\1\s*\)|(?:^|\n)\s*import\s+(?:[^'"]*?\s+from\s+)?(['"])([^'"]+)\3)/g;
// Dynamic-looking require: require( <not a quote> ... i.e. variable/template/concat
const DYNAMIC_REQ_RE = /require\(\s*(?!['"])[^)]*\)/g;

function resolveInternal(fromFile, spec) {
  if (!spec.startsWith('.')) return null; // npm package or node builtin
  const base = path.dirname(path.join(ROOT, fromFile));
  let resolved = path.normalize(path.join(base, spec));
  // Si c'est un dossier, resoudre index.js/.cjs/.mjs AVANT de retourner le
  // dossier nu (sinon un require('../services/x') sur un dossier x/
  // resoud a tort vers "services/x" au lieu de "services/x/index.js").
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    for (const idx of ['index.js', 'index.cjs', 'index.mjs']) {
      const c = path.join(resolved, idx);
      if (fs.existsSync(c)) return path.relative(ROOT, c).replace(/\\/g, '/');
    }
    return path.relative(ROOT, resolved).replace(/\\/g, '/');
  }
  const candidates = [resolved, resolved + '.js', resolved + '.cjs', resolved + '.mjs'];
  for (const c of candidates) {
    if (fs.existsSync(c)) return path.relative(ROOT, c).replace(/\\/g, '/');
  }
  return path.relative(ROOT, resolved).replace(/\\/g, '/') + ' (introuvable)';
}

const results = [];

for (const file of allFiles) {
  const h = readHeader(file);
  if (!h) continue;
  const dependsUnknown = (h.fields.depends || '') === '@unknown';
  const usedByUnknown = (h.fields['used-by'] || '') === '@unknown';
  if (!dependsUnknown && !usedByUnknown) continue;

  // Retire les commentaires (bloc /** */ et ligne //) avant de chercher les
  // require() reels : les exemples "Usage:" en JSDoc produisaient de faux
  // positifs (auto-reference, chemins obsolètes).
  const bodyNoComments = h.txt
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const staticReqs = [];
  let sm;
  STATIC_REQ_RE.lastIndex = 0;
  while ((sm = STATIC_REQ_RE.exec(bodyNoComments))) staticReqs.push(sm[2] || sm[4]);
  const dynamicReqs = (bodyNoComments.match(DYNAMIC_REQ_RE) || []).length;

  const internalStatic = staticReqs
    .map(s => resolveInternal(file, s))
    .filter(Boolean)
    .filter(p => !p.includes('(introuvable)'))
    .filter(p => path.resolve(ROOT, p) !== path.resolve(ROOT, file));

  let usedByHits = [];
  if (usedByUnknown) {
    const base = path.basename(file, path.extname(file));
    // grep across all scanned files for a require(...) mentioning this file's relative path
    const relNoExt = file.replace(/\.(js|cjs|mjs)$/, '');
    for (const other of allFiles) {
      if (other === file) continue;
      let txt;
      try { txt = fs.readFileSync(path.join(ROOT, other), 'utf8'); } catch { continue; }
      txt = txt.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      STATIC_REQ_RE.lastIndex = 0;
      let mm;
      while ((mm = STATIC_REQ_RE.exec(txt))) {
        const spec = mm[2] || mm[4];
        if (!spec.startsWith('.')) continue;
        const resolved = resolveInternal(other, spec);
        if (resolved && resolved.replace(/\.(js|cjs|mjs)$/, '') === relNoExt) {
          usedByHits.push(other);
        }
      }
    }
  }

  const dependsAvoidable = dependsUnknown && internalStatic.length > 0;
  const usedByAvoidable = usedByUnknown && usedByHits.length > 0;
  const isTombstone = /TOMBSTONE/.test(h.txt) && internalStatic.length === 0 && usedByHits.length === 0;

  if (dependsUnknown || usedByUnknown) {
    results.push({
      file,
      dependsUnknown,
      usedByUnknown,
      staticInternalRequires: internalStatic,
      dynamicRequireCallsInBody: dynamicReqs,
      usedByHits: [...new Set(usedByHits)],
      dependsAvoidable,
      usedByAvoidable,
      isTombstone,
      avoidable: dependsAvoidable || usedByAvoidable
    });
  }
}

const avoidable = results.filter(r => r.avoidable && !r.isTombstone);
const tombstones = results.filter(r => r.isTombstone);
const legitimate = results.filter(r => !r.avoidable && !r.isTombstone);

fs.writeFileSync(
  path.join(ROOT, 'scripts', '_unknown-classification.json'),
  JSON.stringify({ total: results.length, avoidableCount: avoidable.length, tombstoneCount: tombstones.length, legitimateCount: legitimate.length, results }, null, 2)
);

console.log(`Fichiers avec @unknown (depends et/ou used-by) : ${results.length}`);
console.log(`  -> EVITABLE (require/import statique ou appelant trouvé, paresse) : ${avoidable.length}`);
console.log(`  -> TOMBSTONE (stub orphelin par conception -> "none")             : ${tombstones.length}`);
console.log(`  -> LEGITIME (aucune résolution statique possible)                 : ${legitimate.length}`);
console.log('');
console.log('--- TOMBSTONE ---');
for (const r of tombstones) console.log(r.file);
console.log('');
console.log('--- LEGITIME (restant) ---');
for (const r of legitimate) console.log(r.file, JSON.stringify(r));
console.log('');
console.log('--- EVITABLE (extrait) ---');
for (const r of avoidable.slice(0, 5)) {
  console.log(`${r.file}`);
  if (r.dependsAvoidable) console.log(`   depends -> ${r.staticInternalRequires.join(', ')}`);
  if (r.usedByAvoidable) console.log(`   used-by -> ${r.usedByHits.join(', ')}`);
}
