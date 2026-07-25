#!/usr/bin/env node
'use strict';

/**
 * check-assets.js — Garde-fou d'existence des assets référencés.
 *
 *   Constat (lot V3) : `panier_tresse_vert.png` a été référencé dans 4 fichiers
 *   vivants alors qu'il n'existait pas sur disque. Aucun des 74 gates existants
 *   ne l'a vu — ils lisent le texte des sources, jamais le système de fichiers.
 *
 *   Ce script extrait toute référence `src="/images/..."` ou `/images/...`
 *   dans une chaîne JS (template literal ou string simple) depuis `index.html`
 *   et `js/**\/*.js`, et vérifie l'existence sur disque sous `public/`.
 *
 *   `css/dist/` (bundles générés) et `coverage/` ne sont pas scannés.
 *
 *   Mode CLIQUET (même pattern que check-important.js) : 3 assets manquants
 *   pré-existants (dette non introduite par ce lot) sont gelés en baseline —
 *   `hero_banner.png`, `og-cover.jpg`, `placeholder-product.png`. Toute
 *   NOUVELLE référence manquante bloque ; ces 3-là ne bloquent pas tant
 *   qu'elles restent la seule dette (aucune baseline gonflée en silence).
 *
 * Usage :
 *   node scripts/check-assets.js --strict   ← bloque toute hausse (pre-commit / CI)
 *   node scripts/check-assets.js --save      ← fige l'état courant comme baseline
 *   node scripts/check-assets.js             ← rapport simple
 */

const fs   = require('fs');
const path = require('path');

const ROOT        = path.resolve(__dirname, '..');       // public/boutique
const PUBLIC_ROOT  = path.resolve(ROOT, '..');            // public
const INDEX_HTML   = path.join(ROOT, 'index.html');
const JS_DIR        = path.join(ROOT, 'js');
const BASELINE      = path.join(__dirname, '.assets-baseline.json');

const args   = process.argv.slice(2);
const strict = args.includes('--strict');
const save   = args.includes('--save');

const RED = '\x1b[31m', GRN = '\x1b[32m', YLW = '\x1b[33m', BLD = '\x1b[1m', DIM = '\x1b[2m', R = '\x1b[0m';

// Référence attendue : chemin absolu depuis la racine servie, ex. /images/foo.png
const REF_RE = /["'(]\s*(\/images\/[A-Za-z0-9_\-./]+\.(?:png|jpe?g|svg|webp|gif|ico))/g;

function walk(dir, exts, ignoreDirs) {
  const out = [];
  (function rec(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (ignoreDirs.includes(entry.name)) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) rec(full);
      else if (exts.some(e => entry.name.endsWith(e))) out.push(full);
    }
  })(dir);
  return out;
}

function collectRefs(file) {
  const text = fs.readFileSync(file, 'utf8');
  const refs = [];
  let m;
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(text)) !== null) {
    refs.push(m[1]);
  }
  return refs;
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE)) return [];
  return JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
}

const files = [
  INDEX_HTML,
  ...walk(JS_DIR, ['.js'], ['dist', 'node_modules']),
];

const seen = new Map(); // asset path -> Set(files referencing it)
for (const file of files) {
  if (!fs.existsSync(file)) continue;
  for (const ref of collectRefs(file)) {
    if (!seen.has(ref)) seen.set(ref, new Set());
    seen.get(ref).add(path.relative(ROOT, file));
  }
}

console.log(`${BLD}${'━'.repeat(3)} check-assets — Komerce ${'━'.repeat(3)}${R}\n`);

const missingAssets = [];
const sortedAssets = [...seen.keys()].sort();
for (const asset of sortedAssets) {
  const onDisk = path.join(PUBLIC_ROOT, asset.replace(/^\//, ''));
  const exists = fs.existsSync(onDisk);
  const refCount = seen.get(asset).size;
  if (exists) {
    console.log(`  ${GRN}✓${R}  ${asset}  ${DIM}(${refCount} référence${refCount > 1 ? 's' : ''})${R}`);
  } else {
    missingAssets.push(asset);
    console.log(`  ${RED}✖  ${asset}  MANQUANT sur disque${R}`);
    for (const ref of seen.get(asset)) {
      console.log(`     ${DIM}↳ référencé par ${ref}${R}`);
    }
  }
}

if (save) {
  fs.writeFileSync(BASELINE, JSON.stringify(missingAssets.sort(), null, 2) + '\n');
  console.log(`\n${YLW}Baseline sauvegardée : ${missingAssets.length} asset(s) manquant(s) gelé(s).${R}`);
  process.exit(0);
}

const baseline = loadBaseline();
const newMissing = missingAssets.filter(a => !baseline.includes(a));
const resolved = baseline.filter(a => !missingAssets.includes(a));

console.log(`\n${BLD}${sortedAssets.length} asset(s) référencé(s), ${missingAssets.length} manquant(s) (baseline : ${baseline.length})${R}`);

if (resolved.length > 0) {
  console.log(`${GRN}  Résolu(s) depuis la baseline : ${resolved.join(', ')} — pensez à relancer --save${R}`);
}

if (newMissing.length > 0) {
  console.log(`\n${RED}${BLD}✖ Nouvel(le) asset(s) manquant(s) hors baseline : ${newMissing.join(', ')}${R}`);
  process.exit(1);
}

if (strict) {
  console.log(`${GRN}${BLD}✔ Aucune hausse d'assets manquants hors baseline.${R}`);
} else {
  console.log(`${GRN}${BLD}✔ check-assets — pas de nouvelle régression.${R}`);
}
process.exit(0);

