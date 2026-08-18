#!/usr/bin/env node
/**
 * INVENTAIRE DES VARIABLES — Extracteur 0B (LOT 0B)
 * ==================================================================
 * Reproductible comme le Golden CDR. Parse les en-têtes @komerce-arch
 * (@db-read / @db-write / @role) de services/ et routes/, et produit,
 * pour chaque TABLE porteuse de variables métier :
 *   - CONSUMED_BY : les modules qui la LISENT (avec leur rôle)
 *   - EDIT_IN     : les modules qui l'ÉCRIVENT
 *   - un flag PHANTOM : écrite mais lue seulement par son propre éditeur
 *                       (= aucun moteur ne la consomme → variable morte)
 *
 * Ne remplit QUE les colonnes factuelles (source, consumed_by, edit_in,
 * phantom). Le typage (MEASURE/POLICY/…), l'owner et le verdict restent
 * du jugement humain — voir docs/LOT_0B_VARIABLES_LIVRABLE.md.
 *
 *   node tools/variables-inventory/inventory.js [--root <repo>] [--json]
 */
'use strict';
const fs = require('fs');
const path = require('path');

// Tables porteuses de variables métier (leviers / config). Étendre au besoin.
const VARIABLE_TABLES = [
  'finance_config', 'customs_categories', 'risk_provisions', 'cost_components',
  'charges', 'business_rules', 'economic_variables',
  'pricing_components', 'pricing_category_taxes', 'pricing_category_dims',
];

const ROOT = (() => {
  const i = process.argv.indexOf('--root');
  return i >= 0 ? process.argv[i + 1] : path.resolve(__dirname, '../..');
})();
const AS_JSON = process.argv.includes('--json');
const SCAN_DIRS = ['services', 'routes'];

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

function parseHeader(txt) {
  const grab = (tag) => {
    const m = txt.match(new RegExp(`@${tag}\\s+([^\\n]+)`));
    return m ? m[1].trim() : '';
  };
  const list = (s) => s.split(',').map(x => x.trim()).filter(x => x && x !== 'none');
  return {
    role: grab('role'),
    reads: list(grab('db-read')),
    writes: list(grab('db-write')),
  };
}

// Un lecteur est un « éditeur qui relit » s'il écrit AUSSI la table et que son rôle est admin.
function isAdminEditor(role) { return /admin/i.test(role); }

const modules = [];
for (const d of SCAN_DIRS) {
  for (const f of walk(path.join(ROOT, d))) {
    const txt = fs.readFileSync(f, 'utf8');
    if (!txt.includes('@komerce-arch')) continue;
    const h = parseHeader(txt);
    modules.push({ file: path.relative(ROOT, f).replace(/\\/g, '/'), ...h });
  }
}

const rows = VARIABLE_TABLES.map(table => {
  const readers = modules.filter(m => m.reads.includes(table));
  const writers = modules.filter(m => m.writes.includes(table));
  const writerFiles = new Set(writers.map(w => w.file));
  // consommateurs "réels" = lecteurs qui ne sont pas juste l'éditeur admin relisant ses écritures
  const engineConsumers = readers.filter(r => !(writerFiles.has(r.file) && isAdminEditor(r.role)));
  const phantom = writers.length > 0 && engineConsumers.length === 0;
  return {
    table,
    consumed_by: engineConsumers.map(r => r.file),
    consumed_by_count: engineConsumers.length,
    editor_readback_only: readers.filter(r => writerFiles.has(r.file) && isAdminEditor(r.role)).map(r => r.file),
    edit_in: writers.map(w => w.file),
    phantom,
  };
});

if (AS_JSON) { console.log(JSON.stringify({ root: ROOT, generated_at: new Date().toISOString(), tables: rows }, null, 2)); process.exit(0); }

// Rendu markdown
const line = (c) => `| ${c.join(' | ')} |`;
console.log(`# Inventaire 0B — sortie brute de l'extracteur\n`);
console.log(`_Racine : ${ROOT} · ${modules.length} modules avec en-tête @komerce-arch._\n`);
console.log(line(['Table', 'CONSUMED_BY (moteurs)', 'EDIT_IN', 'Fantôme ?']));
console.log(line(['---', '---', '---', '---']));
for (const r of rows) {
  const cons = r.consumed_by_count ? `${r.consumed_by_count} — ${r.consumed_by.join(', ')}` : '**0**';
  const edit = r.edit_in.join(', ') || '—';
  const flag = r.phantom ? '⚠️ **PHANTOM** (lue seulement par son éditeur)' : (r.consumed_by_count ? 'non' : '—');
  console.log(line([`\`${r.table}\``, cons, edit || '—', flag]));
}
const phantoms = rows.filter(r => r.phantom);
console.log(`\n**Fantômes détectés : ${phantoms.length}** — ${phantoms.map(p => '`' + p.table + '`').join(', ') || '(aucun)'}`);
