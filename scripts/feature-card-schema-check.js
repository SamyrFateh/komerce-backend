#!/usr/bin/env node
/*
 * @komerce-arch
 * @domain platform-ops
 * @owner platform-ops
 * @responsibility Vérifie que chaque carte features/*.feature.js porte l'intention obligatoire sans dérivé recopié.
 * @inputs features/*.feature.js
 * @outputs process exit code + diagnostic report
 * @depends fs, path
 * @used-by npm run feature:cards, npm run map:check
 * @db-read none
 * @db-write none
 * @db-txn none
 * @doctrine docs/INDEX.md, docs/doctrine/FEATURE_DOCTRINE.md
 * @impact-areas feature-governance, ci-gates
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const FEATURES_DIR = path.join(ROOT, 'features');

const REQUIRED_TOP_LEVEL = ['name', 'status', 'service', 'perimeter', 'authority', 'files', 'contract', 'invariants'];
const FORBIDDEN_KEYS = new Set(['methods', 'selectors', 'exports', 'domSelectors', 'routesReal', 'functions']);

function listFeatureFiles() {
  return fs.readdirSync(FEATURES_DIR)
    .filter((file) => file.endsWith('.feature.js'))
    .sort()
    .map((file) => path.join(FEATURES_DIR, file));
}

function loadCard(file) {
  const resolved = require.resolve(file);
  delete require.cache[resolved];
  return require(file);
}

function hasNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function walkKeys(value, prefix = '') {
  if (!value || typeof value !== 'object') return [];
  const found = [];
  for (const key of Object.keys(value)) {
    const current = prefix ? `${prefix}.${key}` : key;
    found.push(current);
    found.push(...walkKeys(value[key], current));
  }
  return found;
}

function validateCard(card, file) {
  const errors = [];
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');

  for (const key of REQUIRED_TOP_LEVEL) {
    if (!(key in card)) errors.push(`${rel}: champ requis manquant: ${key}`);
  }

  if (!hasNonEmptyString(card.name)) errors.push(`${rel}: name doit être une chaîne non vide`);
  if (!hasNonEmptyString(card.status)) errors.push(`${rel}: status doit être une chaîne non vide`);
  if (!hasNonEmptyString(card.service)) errors.push(`${rel}: service doit être une chaîne non vide`);
  if (!hasNonEmptyString(card.authority)) errors.push(`${rel}: authority doit être une chaîne non vide`);

  if (!card.perimeter || typeof card.perimeter !== 'object') {
    errors.push(`${rel}: perimeter doit exister`);
  } else {
    if (!hasNonEmptyArray(card.perimeter.in)) errors.push(`${rel}: perimeter.in doit être un tableau non vide`);
    if (!hasNonEmptyArray(card.perimeter.out)) errors.push(`${rel}: perimeter.out doit être un tableau non vide`);
  }

  if (!card.contract || typeof card.contract !== 'object') {
    errors.push(`${rel}: contract doit exister`);
  } else {
    if (!Array.isArray(card.contract.exposes)) errors.push(`${rel}: contract.exposes doit être un tableau`);
    if (!Array.isArray(card.contract.consumes)) errors.push(`${rel}: contract.consumes doit être un tableau`);
  }

  if (!hasNonEmptyArray(card.invariants)) errors.push(`${rel}: invariants doit être un tableau non vide`);

  const hasTests = hasNonEmptyArray(card.tests) || Boolean(card.verification && typeof card.verification === 'object');
  if (!hasTests) errors.push(`${rel}: déclarer tests[] ou verification{}`);

  const allKeys = walkKeys(card);
  for (const dotted of allKeys) {
    const last = dotted.split('.').pop();
    if (FORBIDDEN_KEYS.has(last)) {
      errors.push(`${rel}: champ dérivé interdit dans une carte: ${dotted}`);
    }
  }

  return errors;
}

function main() {
  const files = listFeatureFiles();
  const allErrors = [];

  for (const file of files) {
    try {
      const card = loadCard(file);
      allErrors.push(...validateCard(card, file));
    } catch (error) {
      allErrors.push(`${path.relative(ROOT, file)}: impossible de charger la carte: ${error.message}`);
    }
  }

  if (allErrors.length > 0) {
    console.error('❌ feature-card-schema-check: cartes invalides');
    for (const error of allErrors) console.error(` - ${error}`);
    process.exit(1);
  }

  console.log(`✅ feature-card-schema-check: ${files.length} carte(s) valides.`);
}

main();
