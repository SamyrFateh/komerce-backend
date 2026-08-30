#!/usr/bin/env node
'use strict';

/**
 * boutique-ownership-full-check.js — Gate full (branche governance/boutique-global-ownership).
 *
 *   Contrairement à scripts/touched-files-feature-gate.js (qui ne regarde que le diff git),
 *   ce script scanne TOUT public/boutique/js/** et public/boutique/css/*.css et vérifie que
 *   chaque fichier applicatif est rattaché à une carte features/*.feature.js (ou exclu
 *   légitimement : tests, dist, scripts infra — même périmètre que le Gate 1).
 *
 *   B4 : la couverture applicative est désormais fermée à 100%. Les harnais de mesure
 *   navigateur sont exclus du périmètre applicatif au même titre que tests/scripts infra.
 *   Le mode --strict est le gate canonique en CI et doit rester à zéro orphelin.
 *
 * Usage :
 *   node scripts/boutique-ownership-full-check.js            # rapport, exit 0 toujours
 *   node scripts/boutique-ownership-full-check.js --strict   # exit 1 si non-couverts (future passe)
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STRICT = process.argv.includes('--strict');
const C = { red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m', dim: '\x1b[2m', bld: '\x1b[1m', r: '\x1b[0m' };

// Même périmètre d'exclusion que scripts/touched-files-feature-gate.js
const ENFORCE_EXT = /\.(js|mjs|cjs|ts|css|html)$/;
const EXCLUDE = [
  /^archive\//, /node_modules\//, /\/dist\//, /\.github\//, /(^|\/)docs\//,
  /\.md$/, /\.feature\.js$/, /(^|\/)tests?\//, /\.spec\.js$/, /\.test\.js$/,
  /(^|\/)migrations\//, /(^|\/)scripts\//,
  /(^|\/)harnais\//,
  /package(-lock)?\.json$/, /\.config\.(js|cjs|mjs)$/,
  // Backfill gouvernance globale (governance/boutique-global-ownership) :
  // sortie générée (rapport Playwright, jamais du code applicatif) et harnais
  // de test manuel isolé — voir BOUTIQUE_COMPONENT_OWNERSHIP.md §6.2.
  /(^|\/)playwright-report\//,
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

console.log(`\n${C.bld}Gate full — Rattachement Boutique global (governance/boutique-global-ownership)${C.r}`);
console.log(`${C.dim}${enforced.length} fichier(s) applicatif(s) Boutique gouvernables, ${owned.length} rattaché(s), ${orphans.length} non rattaché(s)${C.r}\n`);

if (orphans.length) {
  console.log(`${C.ylw}${C.bld}⚠ ${orphans.length} fichier(s) sans carte feature (dette documentée en partie dans BOUTIQUE_COMPONENT_OWNERSHIP.md §6.2) :${C.r}`);
  orphans.sort().forEach(f => console.log(`${C.ylw}   - ${f}${C.r}`));
}

const coverage = enforced.length ? Math.round((owned.length / enforced.length) * 100) : 100;
console.log(`\n${C.bld}Couverture : ${coverage}%${C.r}`);

if (STRICT && orphans.length) {
  console.log(`\n${C.red}${C.bld}✖ Mode --strict : backfill non terminé.${C.r}`);
  process.exit(1);
}

if (STRICT) console.log(`\n${C.grn}${C.bld}✔ Mode strict — couverture applicative Boutique complète.${C.r}`);
else console.log(`\n${C.grn}${C.bld}✔ Rapport ownership généré.${C.r}`);
process.exit(0);
