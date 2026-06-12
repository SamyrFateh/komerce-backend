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

/* ── Doctrine V4.1 (refonte panier partagé) ─────────────────────────
 * Libellés du modèle « engagement verrouillé », interdits à terme.
 * Mode staged : AVERTISSEMENTS tant que la refonte (Lot 3) n'a pas
 * remplacé les écrans ; deviennent BLOQUANTS avec --v41 (à activer
 * en CI au Lot 5, bascule SHARED_CART_V41).
 * Vocabulaire cible : « Indiquer ma part », « estimation »,
 * « Payer ma part », « Le panier est fermé — paiement ouvert ». */
const FORBIDDEN_V41 = [
  'Enregistrer mon engagement',
  'Mettre à jour mon engagement',
  'Modifier mon engagement',
  'Engagement enregistré',
  'Retrouver mon engagement',
  'engagement verrouillé',
  'Engagement verrouillé',
  "Montant d'engagement",
];

const V41_BLOCKING = process.argv.includes('--v41');

const SCAN_DIRS = ['js', 'css'];
const EXCLUDE_DIRS = new Set([path.join('js', 'dist'), path.join('css', 'dist')]);
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
let v41Hits = 0;

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
      for (const term of FORBIDDEN_V41) {
        if (line.includes(term)) {
          v41Hits++;
          if (V41_BLOCKING) {
            console.error(`✖ ${relFile}:${i + 1} — libellé V4.1 interdit « ${term} »`);
            violations++;
          } else {
            console.warn(`⚠ ${relFile}:${i + 1} — libellé V4.1 à remplacer « ${term} »`);
          }
        }
      }
    });
  }
}

if (violations > 0) {
  console.error(`\n[check-group-wording] ${violations} violation(s) — corriger avant go-live.`);
  process.exit(1);
}

if (v41Hits > 0) {
  console.warn(`[check-group-wording] OK — mais ${v41Hits} libellé(s) V4.1 à remplacer (Lot 3). Bloquant avec --v41.`);
} else {
  console.log('[check-group-wording] OK — aucun libellé interdit dans js/ et css/ (hors dist).');
}
