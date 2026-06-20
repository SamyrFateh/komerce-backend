#!/usr/bin/env node
'use strict';

/**
 * check-important.js — Garde-fou à cliquet sur `!important`.
 *
 *   Doctrine : `!important` ne doit pas proliférer hors des guards desktop.
 *   Cette règle était purement documentaire (README §3) → elle a dérivé.
 *   Ce script la rend exécutable, en mode CLIQUET (jamais big-bang) :
 *     • on gèle le compte actuel par fichier comme référence (`--save`) ;
 *     • toute HAUSSE (nouveau `!important`, ou nouveau fichier qui en introduit)
 *       bloque le commit ;
 *     • une BAISSE est toujours acceptée — et peut être figée au nouvel étiage
 *       avec `--save` (le cliquet ne remonte jamais tout seul).
 *
 * Le dossier `css/dist/` n'est pas scanné (bundles générés).
 *
 * Usage :
 *   node scripts/check-important.js --strict   ← bloque toute hausse (pre-commit / CI)
 *   node scripts/check-important.js --save      ← fige l'état courant comme baseline
 *   node scripts/check-important.js             ← rapport simple
 */

const fs   = require('fs');
const path = require('path');

const ROOT     = path.resolve(__dirname, '..');
const CSS_DIR  = path.join(ROOT, 'css');
const BASELINE = path.join(__dirname, '.important-baseline.json');

const args   = process.argv.slice(2);
const strict = args.includes('--strict');
const save   = args.includes('--save');

const RED = '\x1b[31m', GRN = '\x1b[32m', YLW = '\x1b[33m', BLD = '\x1b[1m', DIM = '\x1b[2m', R = '\x1b[0m';

function cssFiles() {
  // readdirSync ne descend pas dans css/dist/ → les bundles générés sont ignorés.
  return fs.readdirSync(CSS_DIR)
    .filter(f => f.endsWith('.css'))
    .sort();
}

function scan() {
  const perFile = {};
  let total = 0;
  for (const f of cssFiles()) {
    const raw = fs.readFileSync(path.join(CSS_DIR, f), 'utf8');
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, ''); // hors commentaires
    const n = (src.match(/!important/g) || []).length;
    if (n > 0) { perFile[f] = n; total += n; }
  }
  return { perFile, total };
}

function loadBaseline() {
  try { return JSON.parse(fs.readFileSync(BASELINE, 'utf8')); }
  catch { return null; }
}

const result   = scan();
const perFile   = result.perFile;
const total     = result.total;

if (save) {
  fs.writeFileSync(BASELINE, JSON.stringify({ total, perFile, savedAt: new Date().toISOString() }, null, 2));
  console.log(`${GRN}${BLD}✔ Baseline !important figée à ${total} occurrence(s) sur ${Object.keys(perFile).length} fichier(s).${R}`);
  process.exit(0);
}

const baseline = loadBaseline();
if (!baseline) {
  console.error(`${RED}${BLD}✖ Aucune baseline !important.${R} Lance d'abord : node scripts/check-important.js --save`);
  process.exit(strict ? 1 : 0);
}

// Détection des hausses : fichier dont le compte dépasse sa référence, ou nouveau
// fichier introduisant des !important absent de la baseline.
const regressions = [];
for (const [file, n] of Object.entries(perFile)) {
  const ref = baseline.perFile[file] || 0;
  if (n > ref) regressions.push({ file, ref, now: n });
}

// Baisses (info) : utile pour savoir qu'on peut re-figer plus bas.
const drops = [];
for (const [file, ref] of Object.entries(baseline.perFile)) {
  const now = perFile[file] || 0;
  if (now < ref) drops.push({ file, ref, now });
}

console.log(`${BLD}!important — ${total} occurrence(s) (baseline : ${baseline.total})${R}`);

if (drops.length) {
  console.log(`${DIM}  Baisses depuis la baseline (fige-les avec --save) :${R}`);
  drops.forEach(d => console.log(`${GRN}   ↓ ${d.file} : ${d.ref} → ${d.now}${R}`));
}

if (regressions.length === 0) {
  console.log(`${GRN}${BLD}✔ Aucune hausse de !important hors baseline.${R}`);
  process.exit(0);
}

console.log(`${RED}${BLD}✖ ${regressions.length} hausse(s) de !important hors baseline :${R}`);
regressions.forEach(v => console.log(`${RED}   ↑ ${v.file} : ${v.ref} → ${v.now} (+${v.now - v.ref})${R}`));
console.log(`${DIM}  Retire le(s) !important ajouté(s), ou — si la hausse est légitime (guard desktop)${R}`);
console.log(`${DIM}  — fige le nouvel état : npm run check:important:save${R}`);
process.exit(strict ? 1 : 0);
