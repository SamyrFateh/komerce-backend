#!/usr/bin/env node
'use strict';

/**
 * @komerce-arch
 * @domain        infrastructure
 * @type          gate
 * @role          impact-suppression-hygiene
 * @purpose       Refuse les suppressions d'impact mortes, dupliquées ou non justifiées.
 * @doctrine      no_silent_debt
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SUPPRESSIONS_FILE = path.join(__dirname, 'impact-suppressions.json');

function normalizeFile(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function validateSuppressions(suppressions, root = ROOT) {
  const errors = [];
  if (!Array.isArray(suppressions)) return ['impact-suppressions.json doit contenir un tableau JSON.'];

  const seen = new Set();
  suppressions.forEach((entry, index) => {
    const label = `suppression[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${label}: entrée objet attendue.`);
      return;
    }

    const file = normalizeFile(entry.file);
    const category = String(entry.category || '').trim();
    const contains = String(entry.contains || '');
    const reason = String(entry.reason || '').trim();

    if (!file) errors.push(`${label}: file requis.`);
    if (!category) errors.push(`${label}: category requis.`);
    if (!contains) errors.push(`${label}: contains requis.`);
    if (reason.length < 20) errors.push(`${label}: reason doit expliquer le faux positif (>= 20 caractères).`);

    const identity = `${file}\u0000${category}\u0000${contains}`;
    if (seen.has(identity)) errors.push(`${label}: suppression dupliquée (${file} / ${category} / ${JSON.stringify(contains)}).`);
    seen.add(identity);

    if (!file) return;
    const abs = path.resolve(root, file);
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    if (rel.startsWith('../') || path.isAbsolute(rel)) {
      errors.push(`${label}: file sort du dépôt (${file}).`);
      return;
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      errors.push(`${label}: fichier absent (${file}) — supprimer la suppression morte.`);
      return;
    }
    if (contains) {
      const source = fs.readFileSync(abs, 'utf8');
      if (!source.includes(contains)) {
        errors.push(`${label}: marqueur absent de ${file} (${JSON.stringify(contains)}) — supprimer ou corriger la suppression.`);
      }
    }
  });

  return errors;
}

function main() {
  let suppressions;
  try {
    suppressions = JSON.parse(fs.readFileSync(SUPPRESSIONS_FILE, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    console.error(`✖ Impact suppressions illisibles: ${error.message}`);
    process.exit(1);
  }

  const errors = validateSuppressions(suppressions);
  if (errors.length) {
    console.error(`✖ Impact suppressions: ${errors.length} anomalie(s) de gouvernance.`);
    errors.forEach(error => console.error(`   - ${error}`));
    process.exit(1);
  }

  console.log(`✔ Impact suppressions: ${suppressions.length} exception(s) nommée(s), toutes vivantes et justifiées.`);
}

if (require.main === module) main();

module.exports = { normalizeFile, validateSuppressions };
