#!/usr/bin/env node
/*
 * @komerce-arch
 * @domain platform-ops
 * @owner platform-ops
 * @responsibility Vérifie que les fichiers applicatifs touchés appartiennent à une carte feature/transversal.
 * @inputs git diff file list, features/*.feature.js
 * @outputs process exit code + ownership diagnostics
 * @depends child_process, fs, path
 * @used-by npm run feature:touched, CI pull_request
 * @db-read none
 * @db-write none
 * @db-txn none
 * @doctrine docs/INDEX.md, docs/doctrine/FEATURE_DOCTRINE.md
 * @impact-areas feature-governance, ci-gates
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const FEATURES_DIR = path.join(ROOT, 'features');

const APP_PREFIXES = ['services/', 'routes/', 'middleware/', 'utils/', 'validators/', 'core/', 'bootstrap/', 'public/boutique/js/', 'public/boutique/scripts/'];
const IGNORE_PREFIXES = ['archive/', 'docs/', '.github/', 'tests/', 'scripts/'];

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function diffFiles() {
  const base = process.env.BASE_REF || 'origin/main';
  try {
    const mergeBase = git(['merge-base', 'HEAD', base]);
    return git(['diff', '--name-only', `${mergeBase}...HEAD`]).split('\n').filter(Boolean);
  } catch (_) {
    return git(['diff', '--name-only', 'HEAD~1..HEAD']).split('\n').filter(Boolean);
  }
}

function listFeatureFiles() {
  return fs.readdirSync(FEATURES_DIR)
    .filter((file) => file.endsWith('.feature.js'))
    .sort()
    .map((file) => path.join(FEATURES_DIR, file));
}

function flattenFiles(filesValue) {
  const out = new Set();
  function visit(value) {
    if (!value) return;
    if (typeof value === 'string') {
      out.add(value.replace(/\\/g, '/'));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value === 'object') {
      for (const item of Object.values(value)) visit(item);
    }
  }
  visit(filesValue);
  return out;
}

function ownershipIndex() {
  const owners = new Map();
  for (const file of listFeatureFiles()) {
    const resolved = require.resolve(file);
    delete require.cache[resolved];
    const card = require(file);
    const cardName = card.name || path.basename(file);
    const files = flattenFiles(card.files);
    for (const owned of files) {
      if (!owners.has(owned)) owners.set(owned, []);
      owners.get(owned).push(cardName);
    }
  }
  return owners;
}

function isAppFile(file) {
  if (IGNORE_PREFIXES.some((prefix) => file.startsWith(prefix))) return false;
  return APP_PREFIXES.some((prefix) => file.startsWith(prefix));
}

function main() {
  const changed = diffFiles().filter(isAppFile);
  const owners = ownershipIndex();
  const unowned = changed.filter((file) => !owners.has(file));

  if (unowned.length > 0) {
    console.error('❌ Fichiers applicatifs touchés sans propriétaire feature/transversal :');
    for (const file of unowned) console.error(` - ${file}`);
    console.error('\nDéclarer le fichier dans features/<feature>.feature.js ou dans un transversal avant merge.');
    process.exit(1);
  }

  console.log(`✅ touched-files-feature-gate: ${changed.length} fichier(s) applicatif(s) touché(s), tous couverts.`);
}

main();
