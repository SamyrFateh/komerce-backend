#!/usr/bin/env node
/**
 * generate-dashboards-manifests.js
 * 
 * Scanne le disque et genere les manifests features/ pour dashboards.
 * S'adapte automatiquement a la structure reelle — pas de chemins hardcodes.
 *
 * Usage (depuis public/dashboards/) :
 *   node scripts/generate-dashboards-manifests.js
 *   node scripts/generate-dashboards-manifests.js --dry   (affiche sans ecrire)
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT         = path.resolve(__dirname, '..');
const FEATURES_DIR = path.join(ROOT, 'features');
const DRY          = process.argv.includes('--dry');

// ── Scanner les fichiers JS sur disque ──────────────────────────────────

function collectJS(dir, result = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return result;
  for (const entry of fs.readdirSync(abs)) {
    const relEntry = path.join(dir, entry);
    const absEntry = path.join(ROOT, relEntry);
    const stat = fs.statSync(absEntry);
    if (stat.isDirectory()) {
      collectJS(relEntry, result);
    } else if (entry.endsWith('.js') && !entry.endsWith('.min.js')) {
      // Chemin relatif a features/ (convention manifest)
      const fromFeatures = path.relative(FEATURES_DIR, absEntry).replace(/\\/g, '/');
      result.push(fromFeatures);
    }
  }
  return result;
}

// ── Detecter la structure ───────────────────────────────────────────────

// Chercher admin/ (peut etre admin/ ou dashboards/admin/)
let adminDir = null;
let legacyDir = null;

for (const candidate of ['admin', 'dashboards/admin']) {
  if (fs.existsSync(path.join(ROOT, candidate, 'js'))) {
    adminDir = candidate;
    break;
  }
}

for (const candidate of ['admin-legacy', 'dashboards/admin-legacy']) {
  if (fs.existsSync(path.join(ROOT, candidate))) {
    legacyDir = candidate;
    break;
  }
}

if (!adminDir) {
  console.error('Impossible de trouver admin/js/ — verifier la structure du repo.');
  process.exit(1);
}

console.log('Structure detectee :');
console.log('  admin   : ' + adminDir + '/');
console.log('  legacy  : ' + (legacyDir || 'absent'));
console.log('  ROOT    : ' + ROOT);
console.log('  FEATURES: ' + FEATURES_DIR);
console.log('');

// ── Collecter les fichiers ──────────────────────────────────────────────

const adminFiles = collectJS(adminDir);
const legacyFiles = legacyDir ? collectJS(legacyDir + '/js') : [];

// Inclure portal-pilotage.js s'il est dans admin/ directement
const portalFile = path.join(ROOT, adminDir, 'portal-pilotage.js');
if (fs.existsSync(portalFile)) {
  const rel = path.relative(FEATURES_DIR, portalFile).replace(/\\/g, '/');
  if (!adminFiles.includes(rel)) adminFiles.push(rel);
}

console.log('Fichiers trouves :');
console.log('  admin      : ' + adminFiles.length);
console.log('  legacy     : ' + legacyFiles.length);
console.log('  total      : ' + (adminFiles.length + legacyFiles.length));
console.log('');

// ── Generer les manifests ───────────────────────────────────────────────

function buildManifest(name, type, status, domain, service, files) {
  const filesBlock = files.map(f => "      '" + f + "',").join('\n');
  return `'use strict';

module.exports = {
  name:     '${name}',
  type:     '${type}',
  domain:   '${domain}',
  status:   '${status}',
  owner:    'dashboards',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',

  service: "${service}",

  perimeter: {
    in:  ['${adminDir}/**'],
    out: ['API backend'],
  },

  files: {
    js: [
${filesBlock}
    ],
  },

  contract: { exposes: [], consumes: [] },

  authority: 'dashboards',

  invariants: [
    'tout fichier ${domain} doit etre declare ici',
  ],
};
`;
}

const manifests = [];

if (adminFiles.length > 0) {
  manifests.push({
    filename: 'admin-dashboard.feature.js',
    content: buildManifest(
      'admin-dashboard', 'feature', 'production', 'admin-dashboard',
      'Tableau de bord admin SPA multi-vues — pilotage, finance, sourcing, customs, pricing.',
      adminFiles
    ),
  });
}

if (legacyFiles.length > 0) {
  manifests.push({
    filename: 'legacy-control-tower.feature.js',
    content: buildManifest(
      'legacy-control-tower', 'feature', 'deprecated', 'legacy-control-tower',
      'Ancien control tower — conserve pour control-tower.html, supersede par admin/.',
      legacyFiles
    ),
  });
}

// ── Ecriture ────────────────────────────────────────────────────────────

if (!fs.existsSync(FEATURES_DIR)) fs.mkdirSync(FEATURES_DIR, { recursive: true });

for (const m of manifests) {
  const filepath = path.join(FEATURES_DIR, m.filename);
  if (DRY) {
    console.log('DRY: ' + m.filename + ' (' + m.content.split("'../").length + ' fichiers)');
  } else {
    fs.writeFileSync(filepath, m.content, 'utf8');
    console.log('Ecrit : ' + filepath);
  }
}

// ── Verification ────────────────────────────────────────────────────────

if (!DRY) {
  console.log('');
  console.log('Verification :');
  for (const m of manifests) {
    const loaded = require(path.join(FEATURES_DIR, m.filename));
    const files = loaded.files.js || [];
    let missing = 0;
    for (const f of files) {
      const abs = path.resolve(FEATURES_DIR, f);
      if (!fs.existsSync(abs)) { missing++; console.log('  ABSENT: ' + f + ' → ' + abs); }
    }
    console.log('  ' + m.filename + ' : ' + files.length + ' fichiers, ' + missing + ' manquant(s)');
  }
}
