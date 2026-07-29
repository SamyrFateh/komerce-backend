'use strict';
/**
 * Génère `governance-units/*.unit.js` à partir de la partition réelle.
 * Aucune liste écrite à la main : les fichiers revendiqués sont ceux que le
 * disque contient et qu'aucune feature ne déclare — c'est ce qui garantit
 * que la partition ferme.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'governance-units');

const load = (dir, sfx) => fs.readdirSync(path.join(ROOT, dir))
  .filter(f => f.endsWith(sfx) && !f.startsWith('_'))
  .map(f => { const m = { ...require(path.join(ROOT, dir, f)) }; m._file = `${dir}/${f}`; return m; });

const owned = new Set();
for (const m of [...load('features', '.feature.js'), ...load('capabilities', '.capability.js')]) {
  for (const fl of Object.values(m.files || {})) {
    if (Array.isArray(fl)) for (const f of fl) owned.add(String(f).split(path.sep).join('/'));
  }
}

const SKIP = new Set(['.git', 'node_modules']);
function walk(rel) {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, rel || '.'))) {
    if (SKIP.has(e)) continue;
    const r = rel ? `${rel}/${e}` : e;
    let st; try { st = fs.statSync(path.join(ROOT, r)); } catch { continue; }
    if (st.isDirectory()) out.push(...walk(r)); else out.push(r);
  }
  return out;
}
const all = walk('').filter(f => !owned.has(f));

const claim = pred => all.filter(pred).sort();
const taken = new Set();
const take = (pred) => { const l = claim(f => !taken.has(f) && pred(f)); l.forEach(f => taken.add(f)); return l; };

const UNITS = [
  {
    name: 'komerce-ontology',
    stewardship: 'doctrine',
    service: 'Detenir les manifests qui declarent l\'ontologie : features, capabilities et unites de gouvernance.',
    rationale: 'Un manifest ne peut pas se declarer lui-meme sans recursion. Ces fichiers appartiennent a la doctrine, pas a une feature.',
    files: take(f => /^(features\/.*\.feature\.js|capabilities\/.*\.capability\.js|governance-units\/.*\.unit\.js)$/.test(f)),
  },
  {
    name: 'komerce-governance',
    stewardship: 'gouvernance',
    service: 'Outiller la gouvernance : gates, registres d\'arbitrage, generateurs de carte, verificateurs de conformite.',
    rationale: 'Ces outils arbitrent entre les features ; les rattacher a l\'une d\'elles ferait juge et partie.',
    files: take(f => f.startsWith('governance/') || (f.startsWith('scripts/') && /\.(js|mjs|cjs|sh)$/.test(f))),
  },
  {
    name: 'komerce-agent-ops',
    stewardship: 'gouvernance',
    service: 'Outillage PowerShell de gouvernance des agents (staging, revue, livraison, verification de paquet).',
    rationale: 'Process de collaboration, hors runtime et hors contrat metier.',
    files: take(f => f.startsWith('scripts/') && /\.(ps1|psm1)$/.test(f)),
  },
  {
    name: 'komerce-testkit',
    stewardship: 'qualite',
    service: 'Detenir le harnais de test transverse : helpers, fixtures, jeux de donnees et suites non rattachables a une feature unique.',
    rationale: 'Un test qui traverse plusieurs features ne peut pas etre possede par une seule sans fausser la lecture de couverture.',
    files: take(f => f.startsWith('tests/') || f.startsWith('data/catalogue-test-raw/')),
  },
  {
    name: 'komerce-schema',
    stewardship: 'donnees',
    service: 'Detenir le schema versionne et son dump canonique : migrations non rattachees a une feature, outillage de schema.',
    rationale: 'Une migration transverse (index global, correctif multi-tables) n\'appartient a aucune feature ; son autorite est le schema lui-meme.',
    files: take(f => f.startsWith('migrations/') || f === 'schema_railway.sql'),
  },
  {
    name: 'komerce-docs',
    stewardship: 'doctrine',
    service: 'Detenir la documentation, les doctrines, les rapports d\'audit et les cartes generees.',
    rationale: 'Gouvernee par docs-history-lint et registry-doc-check, pas par propriete feature.',
    files: take(f => f.startsWith('docs/') || /\.md$/.test(f)),
  },
  {
    name: 'komerce-repo',
    stewardship: 'plateforme',
    service: 'Detenir la configuration de depot et les actifs statiques servis : dotfiles, manifeste de deploiement, images, pages publiques.',
    rationale: 'Aucune logique, aucune frontiere metier — mais une propriete explicite plutot qu\'un angle mort.',
    files: take(f => !f.startsWith('public/boutique/') && !f.startsWith('public/dashboards/') && !f.startsWith('.agent/')),
  },
];

const EXCLUDED = [
  { pattern: 'public/boutique/**', reason: 'Sous-depot `bout`, gouverne par son propre systeme d\'ownership (scripts/gen-ownership.js, feature-registry-check.js). Deux sources de verite divergeraient — decision actee le 2026-06-26.', count: all.filter(f => f.startsWith('public/boutique/')).length },
  { pattern: 'public/dashboards/**', reason: 'Sous-depot `dash`. Dette explicite : pas encore de systeme d\'ownership equivalent, reevaluee a chaque revue trimestrielle.', count: all.filter(f => f.startsWith('public/dashboards/')).length },
  { pattern: '.agent/**', reason: 'Espace de travail des agents (ledger, livrables, captures). Ne participe ni au runtime, ni aux contrats, ni aux tests.', count: all.filter(f => f.startsWith('.agent/')).length },
];

fs.mkdirSync(OUT, { recursive: true });

for (const u of UNITS) {
  const body = `/**
 * @komerce-arch
 * @role          governance-unit-manifest
 * @domain        ${u.name}
 * @layer         manifest
 * @criticality   medium
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 *
 * @unit          ${u.name}
 * @nature        governance-unit
 */
'use strict';

module.exports = {

  name:        '${u.name}',
  nature:      'governance-unit',   // feature | capability | governance-unit
  stewardship: '${u.stewardship}',  // doctrine | gouvernance | qualite | donnees | plateforme
  status:      'production',
  owner:       'backend-core',
  since:       '2026-07',

  // Une unite de gouvernance n'a PAS de classification business/support :
  // l'axe ne s'applique qu'a \`nature: 'feature'\`. Elle ne rend aucun service
  // client et ne possede aucune verite metier — par construction.
  classification: null,

  service: '${u.service.replace(/'/g, "\\'")}',

  rationale: [
    '${u.rationale.replace(/'/g, "\\'")}',
  ],

  files: {
    governed: [
${u.files.map(f => `      '${f}',`).join('\n')}
    ],
  },

  authority: 'backend-core',

};
`;
  fs.writeFileSync(path.join(OUT, `${u.name}.unit.js`), body, 'utf8');
}

fs.writeFileSync(path.join(OUT, 'EXCLUSIONS.json'),
  `${JSON.stringify({ _doctrine: 'Exclusions explicites de la partition, chacune justifiee. Toute exclusion sans `reason` est une violation.', exclusions: EXCLUDED }, null, 2)}\n`, 'utf8');

console.log('Unites generees :');
UNITS.forEach(u => console.log(`   ${String(u.files.length).padStart(5)}  ${u.name}`));
console.log(`   ${String(EXCLUDED.reduce((n, e) => n + e.count, 0)).padStart(5)}  (exclusions justifiees)`);
const rest = all.filter(f => !taken.has(f) && !f.startsWith('public/boutique/') && !f.startsWith('public/dashboards/') && !f.startsWith('.agent/'));
console.log(`\nReliquat non couvert : ${rest.length}`);
rest.slice(0, 20).forEach(f => console.log('   ' + f));
