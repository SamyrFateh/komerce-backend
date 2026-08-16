#!/usr/bin/env node
'use strict';

/**
 * boutique-ownership-full-check.js — gate global de rattachement Boutique.
 *
 * Contrairement à scripts/touched-files-feature-gate.js (qui ne regarde que le diff git),
 * ce script scanne TOUT public/boutique et vérifie que chaque fichier applicatif
 * gouvernable est rattaché à une carte features/*.feature.js.
 *
 * Les artefacts, tests et harnais de diagnostic non applicatifs sont exclus explicitement
 * du périmètre. Le gate est STRICT par défaut : tout nouvel orphelin applicatif bloque.
 *
 * Usage :
 *   node scripts/boutique-ownership-full-check.js            # strict, exit 1 si orphelin
 *   node scripts/boutique-ownership-full-check.js --strict   # idem, explicite
 *   node scripts/boutique-ownership-full-check.js --report   # rapport non bloquant
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STRICT = !process.argv.includes('--report');
const C = { red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m', dim: '\x1b[2m', bld: '\x1b[1m', r: '\x1b[0m' };

// Même périmètre d'exclusion que scripts/touched-files-feature-gate.js,
// complété par les harnais de mesure navigateur : ce sont des outils de diagnostic,
// jamais du code applicatif chargé par la Boutique.
const ENFORCE_EXT = /\.(js|mjs|cjs|ts|css|html)$/;
const EXCLUDE = [
  /^archive\//, /node_modules\//, /\/dist\//, /\.github\//, /(^|\/)docs\//,
  /\.md$/, /\.feature\.js$/, /(^|\/)tests?\//, /\.spec\.js$/, /\.test\.js$/,
  /(^|\/)migrations\//, /(^|\/)scripts\//,
  /package(-lock)?\.json$/, /\.config\.(js|cjs|mjs)$/,
  /(^|\/)playwright-report\//,
  /(^|\/)harnais\/geometry\//,
  /(^|\/)test-modal-view-model\.html$/,
];

function walk(dir, acc) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function loadCards() {
  const cards = [];
  for (const dir of ['features', 'public/boutique/features']) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (!f.endsWith('.feature.js')) continue;
      try { const m = require(path.join(abs, f)); m.__base = abs; cards.push(m); } catch {}
    }
  }
  return cards;
}

function repoRel(abs) { return path.relative(ROOT, abs).replace(/\\/g, '/'); }

function declaredPath(cardBase, rel) {
  const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || clean.endsWith('/')) return null;
  if (clean.startsWith('../')) return repoRel(path.resolve(cardBase, clean));
  const rootCandidate = path.join(ROOT, clean);
  if (fs.existsSync(rootCandidate)) return clean;
  const localCandidate = path.resolve(cardBase, clean);
  if (fs.existsSync(localCandidate)) return repoRel(localCandidate);
  const boutiqueCandidate = path.join(ROOT, 'public/boutique', clean);
  if (fs.existsSync(boutiqueCandidate)) return `public/boutique/${clean}`;
  return clean;
}

function ownershipIndex(cards) {
  const owner = {};
  for (const m of cards) {
    const files = Object.values(m.files || {}).flat();
    for (const rel of files) {
      const repoRelPath = declaredPath(m.__base, rel);
      if (repoRelPath) owner[repoRelPath] = m.name;
    }
  }
  return owner;
}

const cards = loadCards();
const owner = ownershipIndex(cards);

const boutiqueRoot = path.join(ROOT, 'public/boutique');
const allFiles = walk(boutiqueRoot, []).map(repoRel);
const enforced = allFiles.filter(f => ENFORCE_EXT.test(f) && !EXCLUDE.some(rx => rx.test(f)));

const owned = [];
const orphans = [];
for (const f of enforced) {
  if (owner[f]) owned.push(f);
  else orphans.push(f);
}

console.log(`\n${C.bld}Gate full — Rattachement Boutique global${C.r}`);
console.log(`${C.dim}${enforced.length} fichier(s) applicatif(s) Boutique gouvernables, ${owned.length} rattaché(s), ${orphans.length} non rattaché(s)${C.r}\n`);

if (orphans.length) {
  console.log(`${C.ylw}${C.bld}⚠ ${orphans.length} fichier(s) applicatif(s) sans carte feature :${C.r}`);
  orphans.sort().forEach(f => console.log(`${C.ylw}   - ${f}${C.r}`));
}

const coverage = enforced.length ? Math.round((owned.length / enforced.length) * 100) : 100;
console.log(`\n${C.bld}Couverture : ${coverage}%${C.r}`);

if (STRICT && orphans.length) {
  console.log(`\n${C.red}${C.bld}✖ Ownership Boutique strict : ${orphans.length} orphelin(s) applicatif(s).${C.r}`);
  process.exit(1);
}

if (STRICT) {
  console.log(`\n${C.grn}${C.bld}✔ Ownership Boutique strict : 0 orphelin applicatif.${C.r}`);
} else {
  console.log(`\n${C.grn}${C.bld}✔ Rapport ownership généré (--report non bloquant).${C.r}`);
}
process.exit(0);
