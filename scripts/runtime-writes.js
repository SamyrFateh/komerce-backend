'use strict';
/**
 * Recalcul des writers sur le RUNTIME SEULEMENT.
 *
 * Exclus du calcul (ce sont des `technical-writer` par nature, ils ne portent
 * aucune décision métier) :
 *   · scripts/**                       — outillage, seeds, correctifs ponctuels
 *   · migrations/**                    — DDL versionné
 *   · bootstrap/startup-migrations.js  — DDL au démarrage
 *   · db/**                            — schéma
 *   · tests/**
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const load = (dir, sfx) => fs.readdirSync(path.join(ROOT, dir))
  .filter(f => f.endsWith(sfx) && !f.startsWith('_'))
  .map(f => { const m = { ...require(path.join(ROOT, dir, f)) }; m._file = `${dir}/${f}`; return m; });

const manifests = [...load('features', '.feature.js'), ...load('capabilities', '.capability.js')];

const RUNTIME_GROUPS = new Set(['services', 'routes', 'middleware', 'utils', 'validators', 'core', 'bootstrap', 'config']);
const EXCLUDED_FILES = new Set(['bootstrap/startup-migrations.js', 'db.js', 'server.js']);

const owner = new Map();
for (const m of manifests) {
  for (const [g, fl] of Object.entries(m.files || {})) {
    if (!RUNTIME_GROUPS.has(g) || !Array.isArray(fl)) continue;
    for (const f of fl) {
      const k = String(f).split(path.sep).join('/');
      if (EXCLUDED_FILES.has(k)) continue;
      if (!/\.js$/.test(k)) continue;
      owner.set(k, m.name || m._file);
    }
  }
}

// Écritures SQL réelles. On ignore les CREATE/ALTER/DROP : ce sont du DDL,
// donc du `technical-writer` même quand il traîne dans un fichier runtime.
// Vocabulaire de tables réel, extrait du schéma canonique : sans ce filtre le
// parseur ramasse des mots français présents dans les commentaires SQL.
const REAL_TABLES = new Set(
  (fs.readFileSync(path.join(ROOT, 'schema_railway.sql'), 'utf8')
    .match(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?"?([a-z_0-9]+)"?/gi) || [])
    .map(x => x.replace(/.*[ .]/, '').replace(/"/g, '').toLowerCase())
);

const WRITE_RX = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:ONLY\s+)?["`]?([a-z_][a-z0-9_]*)["`]?/gi;

const writes = new Map();   // table → Map(feature → [ {file, verb} ])
let scanned = 0;
for (const [file, feature] of owner) {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) continue;
  scanned++;
  const src = fs.readFileSync(abs, 'utf8');
  let m;
  WRITE_RX.lastIndex = 0;
  while ((m = WRITE_RX.exec(src)) !== null) {
    const verb = m[1].toUpperCase().replace(/\s+/g, ' ');
    const table = m[2].toLowerCase();
    if (!REAL_TABLES.has(table)) continue; // filtre anti-faux-positif (mots dans commentaires/gabarits)
    if (!writes.has(table)) writes.set(table, new Map());
    const byFeat = writes.get(table);
    if (!byFeat.has(feature)) byFeat.set(feature, []);
    byFeat.get(feature).push({ file, verb });
  }
}

const rows = [...writes.entries()]
  .map(([table, byFeat]) => ({
    table,
    features: [...byFeat.keys()].sort(),
    detail: [...byFeat.entries()].map(([f, ev]) => ({ feature: f, files: [...new Set(ev.map(e => e.file))] })),
  }))
  .sort((a, b) => b.features.length - a.features.length || a.table.localeCompare(b.table));

const multi = rows.filter(r => r.features.length > 1);

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify({ scannedFiles: scanned, tables: rows }, null, 2)}\n`);
  process.exit(0);
}

console.log('=== ÉCRITURES RUNTIME SEULES ===\n');
console.log(`  Fichiers runtime scannés          : ${scanned}`);
console.log(`  Tables écrites en runtime         : ${rows.length}`);
console.log(`  Tables à plusieurs features       : ${multi.length}   (déclaré aujourd'hui : 39)\n`);

console.log('--- Tables multi-features (runtime) ---');
for (const r of multi) {
  console.log(`\n  ${r.table}  (${r.features.length})`);
  for (const d of r.detail) console.log(`      ${d.feature.padEnd(20)} ${d.files.slice(0, 3).join(', ')}${d.files.length > 3 ? ` … +${d.files.length - 3}` : ''}`);
}

console.log('\n\n--- Tables mono-feature (propriété nette) ---');
console.log(rows.filter(r => r.features.length === 1)
  .map(r => `  ${r.table.padEnd(38)} ${r.features[0]}`).join('\n'));
