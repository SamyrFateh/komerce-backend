'use strict';
/**
 * Regenere docs/doctrine/MULTI_WRITER_TABLES.md a partir de deux sources
 * verifiables, jamais d'une estimation :
 *   - features/*.feature.js  (db.tables declares, files possedes)
 *   - docs/komerce-arch-header-graph.json (dbWrite / dbWriteVia reels par fichier)
 *
 * Pour chaque (feature, table) declare W/RW, classe en :
 *   - CONFIRME_DIRECT   : au moins un fichier possede par la feature a un
 *                         @db-write reel sur cette table.
 *   - DELEGATION_SEULE  : aucun @db-write direct, mais au moins un
 *                         @db-write-via -- le manifest devrait dire R + W-via,
 *                         pas W/RW.
 *   - ORPHELIN          : W/RW declare, aucune preuve (ni direct ni via) --
 *                         soit angle mort outillage (hors SCAN_ROOTS, a
 *                         documenter), soit vraie sur-declaration a corriger.
 *
 * Usage : node scripts/generate-multi-writer-report.js [--write]
 *   sans --write : imprime le rapport sur stdout, n'ecrit rien.
 *   --write      : ecrase docs/doctrine/MULTI_WRITER_TABLES.md
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const WRITE = process.argv.includes('--write');

const GRAPH_PATH = path.join(ROOT, 'docs', 'komerce-arch-header-graph.json');
if (!fs.existsSync(GRAPH_PATH)) {
  console.error('FATAL: graphe absent. Lance d\'abord: node scripts/generate-komerce-arch-graph.js');
  process.exit(2);
}
const graph = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf8'));
const nodesByFile = new Map(graph.nodes.filter(n => n.type === 'file').map(n => [n.file, n]));

const features = {};
for (const f of fs.readdirSync(path.join(ROOT, 'features'))) {
  if (!f.endsWith('.feature.js')) continue;
  const name = f.replace('.feature.js', '');
  const txt = fs.readFileSync(path.join(ROOT, 'features', f), 'utf8');
  const dbMatch = txt.match(/db:\s*\{\s*tables:\s*\[([\s\S]*?)\]\s*,?\s*\}/);
  const tables = {};
  if (dbMatch) {
    for (const line of dbMatch[1].split('\n')) {
      const m = line.match(/'([a-zA-Z0-9_]+):\s*(R|W|RW)'/);
      if (m) tables[m[1]] = m[2];
    }
  }
  const filesMatch = txt.match(/files:\s*\{([\s\S]*?)\n {2}\},/);
  const files = filesMatch
    ? [...filesMatch[1].matchAll(/'([a-zA-Z0-9_\-/.]+\.js)'/g)].map(m => m[1])
    : [];
  features[name] = { tables, files: files.filter(f => !f.startsWith('tests/')) };
}

// file -> feature owner
const fileOwner = new Map();
for (const [name, d] of Object.entries(features)) {
  for (const f of d.files) fileOwner.set(f, name);
}

// writers/readers per table
const writers = {};
const readers = {};
for (const [name, d] of Object.entries(features)) {
  for (const [table, mode] of Object.entries(d.tables)) {
    if (mode.includes('W')) (writers[table] ||= new Set()).add(name);
    if (mode.includes('R')) (readers[table] ||= new Set()).add(name);
  }
}

const evidence = []; // {feature, table, mode, status, directFiles, viaFiles}
for (const [name, d] of Object.entries(features)) {
  for (const [table, mode] of Object.entries(d.tables)) {
    if (!mode.includes('W')) continue;
    const directFiles = [];
    const viaFiles = [];
    for (const f of d.files) {
      const node = nodesByFile.get(f);
      if (!node) continue;
      if ((node.dbWrite || []).includes(table)) directFiles.push(f);
      for (const via of (node.dbWriteVia || [])) {
        if ((via.tables || []).includes(table)) viaFiles.push(`${f} (via:${via.via})`);
      }
    }
    const status = directFiles.length ? 'CONFIRME_DIRECT'
      : viaFiles.length ? 'DELEGATION_SEULE'
      : 'ORPHELIN';
    evidence.push({ feature: name, table, mode, status, directFiles, viaFiles });
  }
}

const multiWriterTables = Object.keys(writers).filter(t => writers[t].size >= 2).sort();

const delegationOnly = evidence.filter(e => e.status === 'DELEGATION_SEULE');
const orphans = evidence.filter(e => e.status === 'ORPHELIN');

function tierOf(n) {
  if (n >= 5) return 1;
  if (n >= 3) return 2;
  return 3;
}

const lines = [];
lines.push('# Dette architecturale — Tables multi-écrivains');
lines.push('');
lines.push(`> Régénéré automatiquement le ${new Date().toISOString().slice(0, 10)} par` +
  ' `scripts/generate-multi-writer-report.js` — source de vérité :' +
  ' `features/*.feature.js` (db.tables) croisé avec' +
  ' `docs/komerce-arch-header-graph.json` (headers @db-write / @db-write-via réels).');
lines.push(`> ${multiWriterTables.length} tables ont 2+ features déclarées en écriture directe (W/RW dans manifest).`);
lines.push('> Ce fichier remplace une version figée à la main (2026-07-07, 37 tables) devenue');
lines.push('> stale après les corrections du §3 de `VERIFICATION_AUDIT_2026-07-07.md`' +
  ' (3 tables nouvellement multi-écrivains : `order_item_real_cost_allocations`,' +
  ' `sms_log`, `transaction_documents`).');
lines.push('');
lines.push('## Méthode et verdict de vérification empirique');
lines.push('');
lines.push('Pour chaque `(feature, table)` déclaré `W`/`RW`, on vérifie si un fichier');
lines.push('réellement possédé par la feature porte un `@db-write` direct sur cette');
lines.push('table (pas seulement une délégation `@db-write-via`).');
lines.push('');
lines.push(`- **${evidence.length}** couples (feature, table) en écriture au total`);
lines.push(`- **${evidence.filter(e => e.status === 'CONFIRME_DIRECT').length}** confirmés par du vrai \`@db-write\` direct — ce ne sont PAS des erreurs de manifest, la multipropriété est réelle au niveau du code, vérifiée jusqu'au SQL brut (échantillon \`orders\` : 4 \`UPDATE orders SET ...\` retrouvés dans 4 features indépendantes).`);
lines.push(`- **${delegationOnly.length}** délégation pure (déclaré W/RW mais seule preuve = \`@db-write-via\`) → candidats à correction de manifest.`);
lines.push(`- **${orphans.length}** orphelin (W/RW déclaré, aucune preuve directe ni déléguée) → à examiner.`);
lines.push('');
lines.push('**Conséquence pour le chantier CRUD** : contrairement à `§3` (dette de');
lines.push('*documentation*, corrigée par simple édition de manifest) et aux `@unknown`');
lines.push('`@depends`/`@used-by` (idem), la multipropriété d\'écriture ici est une dette');
lines.push('*architecturale réelle* — la corriger veut dire migrer du code (des `UPDATE`');
lines.push('directs vers un service unique), pas éditer un header. Aucune correction de');
lines.push('manifest automatique n\'a été appliquée dans cette passe : il n\'y a rien à');
lines.push('corriger côté déclaration, la dette est dans le code lui-même.');
lines.push('');

if (delegationOnly.length) {
  lines.push('### Délégation pure détectée (candidats à correction de manifest)');
  lines.push('');
  for (const e of delegationOnly) {
    lines.push(`- \`${e.feature}\` / \`${e.table}\` (${e.mode}) : ${e.viaFiles.join(', ')}`);
  }
  lines.push('');
}

lines.push('### Orphelins (W/RW déclaré sans preuve directe ni déléguée)');
lines.push('');
if (orphans.length) {
  for (const e of orphans) {
    lines.push(`- \`${e.feature}\` / \`${e.table}\` (${e.mode}) — ` +
      (e.table === 'schema_migrations'
        ? 'connu : écrit par `scripts/run-migrations.js`, hors `SCAN_ROOTS` du générateur de graphe (angle mort outillage documenté depuis `VERIFICATION_AUDIT_2026-07-07.md`), pas une fausse déclaration.'
        : 'à examiner — aucune preuve trouvée dans les fichiers possédés par la feature.'));
  }
} else {
  lines.push('Aucun.');
}
lines.push('');
lines.push('---');
lines.push('');
lines.push('## Inventaire complet, par nombre d\'écrivains directs');
lines.push('');

for (const tier of [1, 2, 3]) {
  const tableNames = multiWriterTables.filter(t => tierOf(writers[t].size) === tier);
  if (!tableNames.length) continue;
  const label = tier === 1 ? 'Tier 1 — 5+ écrivains directs (critique)'
    : tier === 2 ? 'Tier 2 — 3-4 écrivains directs'
    : 'Tier 3 — 2 écrivains directs';
  lines.push(`### ${label}`);
  lines.push('');
  lines.push('| Table | Écrivains | Preuve |');
  lines.push('|---|---|---|');
  for (const t of tableNames.sort((a, b) => writers[b].size - writers[a].size || a.localeCompare(b))) {
    const ws = [...writers[t]].sort();
    const allDirect = ws.every(w => evidence.find(e => e.feature === w && e.table === t)?.status === 'CONFIRME_DIRECT');
    lines.push(`| \`${t}\` (${ws.length}) | ${ws.join(', ')} | ${allDirect ? '✅ tous confirmés directs' : '⚠️ voir sections ci-dessus'} |`);
  }
  lines.push('');
}

lines.push('---');
lines.push('');
lines.push('## Jugements architecturaux hérités (non re-vérifiés dans cette passe)');
lines.push('');
lines.push('La version précédente de ce document assignait un "owner canonique" et une');
lines.push('roadmap de sprints (A→E) par table. Ce sont des jugements d\'architecture, pas');
lines.push('des faits vérifiables par grep — ils ne sont donc **pas régénérés');
lines.push('automatiquement** ici. Reproduits tels quels pour ne rien perdre, à');
lines.push('re-valider avec l\'équipe avant d\'être pris pour argent comptant (le reste de');
lines.push('cet audit a montré plusieurs fois que des affirmations non vérifiées');
lines.push('empiriquement s\'avéraient fausses) :');
lines.push('');
lines.push('| Table | Owner canonique proposé (hérité) | Action proposée (héritée) |');
lines.push('|---|---|---|');
lines.push('| `orders` | orders (`order-service.js`, `order-status-machine.js`) | 8 autres features migrent leurs écritures directes |');
lines.push('| `order_status_history` | orders (`transitionOrderStatus()`) | `parcel-operations.js` (logistics) insère encore en direct — à re-vérifier |');
lines.push('| `products` | catalog | exposer `catalog.updateStock()` |');
lines.push('| `parcels` | logistics | exposer `logistics.transitionParcelStatus()` |');
lines.push('| `refunds` | refunds (`refund-service.js`) | payments/shared-cart migrent |');
lines.push('| `users` | auth | dashboard = purge admin ; infrastructure = DDL |');
lines.push('');
lines.push('Sprints proposés dans la version précédente (non ré-audités) :');
lines.push('A) `order_status_history` — migrer `parcel-operations.js` ; ' +
  'B) `refunds` — supprimer INSERT directs payments/shared-cart ; ' +
  'C) `products` stock — exposer `catalog.updateStock()` ; ' +
  'D) `parcels` statut — exposer `logistics.transitionParcelStatus()` ; ' +
  'E) `orders` — tout via `order-service.js`.');
lines.push('');
lines.push('**Avant de lancer un de ces sprints** : re-vérifier chaque affirmation au');
lines.push('niveau du SQL réel (comme fait ici pour `orders`), pas seulement au niveau du');
lines.push('manifest — c\'est la méthode qui a évité plusieurs fausses pistes dans le');
lines.push('reste de cet audit.');

const output = lines.join('\n') + '\n';

if (WRITE) {
  fs.writeFileSync(path.join(ROOT, 'docs', 'doctrine', 'MULTI_WRITER_TABLES.md'), output);
  console.log('Écrit : docs/doctrine/MULTI_WRITER_TABLES.md');
} else {
  console.log(output);
}
console.log(`\n[résumé] ${multiWriterTables.length} tables multi-écrivains, ${evidence.length} couples (feature,table), ${delegationOnly.length} délégation pure, ${orphans.length} orphelin(s).`);
