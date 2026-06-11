#!/usr/bin/env node
'use strict';

/**
 * scripts/check-group-wording.js
 *
 * Garde-fou LOT 10 (brief BUSINESS + UX FIX PANIER PARTAGÉ V4).
 * Échoue si un libellé interdit réapparaît dans les sources boutique
 * (js/ et css/, hors js/dist qui est un artefact de build).
 *
 * Libellés interdits côté client (LOT 7) :
 *   - "Enregistrer ma participation"
 *   - "Je contribue"
 *   - "Valider disponible à 100%"
 *   - "Passer au règlement"
 *
 * Usage : node scripts/check-group-wording.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FORBIDDEN = [
  'Enregistrer ma participation',
  'Je contribue',
  'Valider disponible à 100%',
  'Passer au règlement',
];

const SCAN_DIRS = ['js', 'css'];
const EXCLUDE_DIRS = new Set([path.join('js', 'dist')]);
const EXTENSIONS = new Set(['.js', '.css', '.html']);

function* walk(dir, rel = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = path.join(rel, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(relPath)) continue;
      yield* walk(path.join(dir, entry.name), relPath);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      yield relPath;
    }
  }
}

let violations = 0;

for (const dirName of SCAN_DIRS) {
  const dirPath = path.join(ROOT, dirName);
  if (!fs.existsSync(dirPath)) continue;

  for (const relFile of walk(dirPath, dirName)) {
    const content = fs.readFileSync(path.join(ROOT, relFile), 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      for (const term of FORBIDDEN) {
        if (line.includes(term)) {
          console.error(`✖ ${relFile}:${i + 1} — libellé interdit « ${term} »`);
          violations++;
        }
      }
    });
  }
}

if (violations > 0) {
  console.error(`\n[check-group-wording] ${violations} violation(s) LOT 7/10 — corriger avant go-live.`);
  process.exit(1);
}

console.log('[check-group-wording] OK — aucun libellé interdit dans js/ et css/ (hors dist).');
