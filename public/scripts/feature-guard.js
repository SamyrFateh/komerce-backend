#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FEATURES_DIR = path.join(ROOT, 'features');
const STRICT = process.argv.includes('--strict');
const errors = [];
const warnings = [];

function loadManifests() {
  if (!fs.existsSync(FEATURES_DIR)) return [];
  return fs.readdirSync(FEATURES_DIR).filter(f => f.endsWith('.feature.js')).map(f => {
    try { const m = require(path.join(FEATURES_DIR, f)); m._file = f; return m; }
    catch(e) { return { _file: f, _loadError: e.message }; }
  });
}

const manifests = loadManifests();
const valid = manifests.filter(m => !m._loadError);

// Check 1: champs obligatoires
for (const m of valid) {
  for (const field of ['name','domain','status','owner','files']) {
    if (!m[field]) errors.push('[' + m.name + '] champ "' + field + '" manquant');
  }
}

// Check 2: fichiers existent
for (const m of valid) {
  if (!m.files) continue;
  for (const [group, files] of Object.entries(m.files)) {
    if (!Array.isArray(files)) continue;
    for (const f of files) {
      const abs = path.resolve(FEATURES_DIR, f);
      if (!fs.existsSync(abs)) errors.push('[' + m.name + '] fichier absent: ' + f);
    }
  }
}

// Check 3: @domain cohérence
for (const m of valid) {
  if (!m.files || !m.files.js) continue;
  for (const f of m.files.js) {
    const abs = path.resolve(FEATURES_DIR, f);
    if (!fs.existsSync(abs)) continue;
    const head = fs.readFileSync(abs, 'utf8').slice(0, 2000);
    const dm = head.match(/@domain\s+(\S+)/);
    if (dm && dm[1] !== m.domain) {
      errors.push('[' + m.name + '] @domain mismatch: ' + f + ' dit @domain ' + dm[1] + ' mais est dans ' + m.domain);
    }
  }
}

console.log('\n  Feature Slice Guard — Dashboards (N5)\n');
console.log('  Slices verifies   : ' + valid.length);
console.log('  Erreurs           : ' + errors.length);
console.log('  Avertissements    : ' + warnings.length);

if (errors.length === 0 && warnings.length === 0) {
  console.log('\n  ✅ Tous les slices sont coherents.\n');
} else {
  errors.forEach(e => console.log('  ❌ ' + e));
  warnings.forEach(w => console.log('  ⚠️  ' + w));
  console.log('');
}
if (STRICT && errors.length > 0) process.exit(1);
