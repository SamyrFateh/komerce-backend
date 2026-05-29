#!/usr/bin/env node
/**
 * check-js-bundle.js — Garde-fou bundle JS Komerce boutique
 * Version : 1.0 (2026-05-30)
 *
 * Vérifie que js/dist/ est synchronisé avec index.html.
 * S'intègre dans npm run check:all (après check:imports, avant audit:arch).
 *
 * Ce que ce script vérifie :
 *   B-1  js/dist/.bundle-state.json existe
 *   B-2  Le bundle principal référencé dans le state existe sur disque
 *   B-3  La taille du bundle est dans la plage attendue (50 KB – 2 MB)
 *   B-4  index.html référence bien ce bundle (pas une version obsolète)
 *   B-5  Le state est récent (< 24h) — warn si plus vieux, pas d'erreur
 *        (Railway peut déployer un state vieux de quelques heures)
 *
 * Usage :
 *   node scripts/check-js-bundle.js
 *   npm run check:bundle
 *
 * Sortie : exit 0 si tout passe, exit 1 si erreur bloquante.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ────────────────────────────────────────────────────────────────────
// CONFIG
// ────────────────────────────────────────────────────────────────────

const ROOT       = path.resolve(__dirname, '..');
const OUT_DIR    = path.join(ROOT, 'js', 'dist');
const STATE_FILE = path.join(OUT_DIR, '.bundle-state.json');
const INDEX_HTML = path.join(ROOT, 'index.html');

const MIN_BUNDLE_KB = 50;
const MAX_BUNDLE_KB = 2048;

// ────────────────────────────────────────────────────────────────────
// COULEURS (cohérent avec check-cache-buster.js)
// ────────────────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN  = '\x1b[32m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';

let errors   = 0;
let warnings = 0;

function ok(msg)   { console.log(`${GREEN}  ✔${RESET}  ${msg}`); }
function warn(msg) { console.warn(`${YELLOW}  ⚠${RESET}  ${msg}`); warnings++; }
function fail(msg) { console.error(`${RED}  ✖${RESET}  ${msg}`); errors++; }

// ────────────────────────────────────────────────────────────────────
// VÉRIFICATIONS
// ────────────────────────────────────────────────────────────────────

console.log(`\n${BOLD}🔍 check:bundle${RESET} — vérification js/dist/\n`);

// ── B-1 : existence du state ──────────────────────────────────────────
if (!fs.existsSync(STATE_FILE)) {
  fail('js/dist/.bundle-state.json absent.');
  fail('Lancer : npm run bundle:js');
  console.log('');
  process.exit(1);
}

let state;
try {
  state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
} catch (e) {
  fail(`js/dist/.bundle-state.json illisible : ${e.message}`);
  fail('Lancer : npm run bundle:js');
  console.log('');
  process.exit(1);
}

ok(`State trouvé (mode : ${state.mode || 'inconnu'})`);

// ── B-2 : fraîcheur (warn seulement) ─────────────────────────────────
if (state.updatedAt) {
  const ageMs  = Date.now() - new Date(state.updatedAt).getTime();
  const ageMin = Math.round(ageMs / 60_000);
  const ageH   = Math.round(ageMs / 3_600_000);

  if (ageMs > 24 * 3_600_000) {
    warn(`Bundle vieux de ${ageH}h — relancer npm run bundle:js si les sources JS ont changé`);
  } else {
    ok(`Bundle récent (${ageMin < 60 ? `${ageMin} min` : `${ageH}h`})`);
  }
} else {
  warn('Pas de timestamp dans le state');
}

// ── B-3 : bundle principal présent + taille ───────────────────────────
if (!state.mainBundle) {
  fail('Champ "mainBundle" absent du state.');
  errors++;
} else {
  const mainPath = path.join(OUT_DIR, state.mainBundle);

  if (!fs.existsSync(mainPath)) {
    fail(`Bundle principal introuvable : js/dist/${state.mainBundle}`);
    fail('Lancer : npm run bundle:js');
  } else {
    const sizeKB = Math.round(fs.statSync(mainPath).size / 1024);
    ok(`Bundle principal : ${BOLD}${state.mainBundle}${RESET} (${sizeKB} KB)`);

    if (sizeKB < MIN_BUNDLE_KB) {
      fail(`Bundle < ${MIN_BUNDLE_KB} KB (${sizeKB} KB) — build suspect, vérifier js/main.js`);
    }
    if (sizeKB > MAX_BUNDLE_KB) {
      fail(`Bundle > ${MAX_BUNDLE_KB} KB (${sizeKB} KB) — investiguer avant de déployer`);
    }
  }
}

// ── B-4 : index.html pointe sur le bon bundle ─────────────────────────
let html;
try {
  html = fs.readFileSync(INDEX_HTML, 'utf8');
} catch (e) {
  fail(`index.html illisible : ${e.message}`);
  html = null;
}

if (html) {
  const match = html.match(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/);

  if (!match) {
    fail('Balise <script type="module" src="..."> introuvable dans index.html.');
  } else {
    const srcInHtml  = match[1];
    const expected   = `/boutique/js/dist/${state.mainBundle}`;

    if (srcInHtml === expected) {
      ok(`index.html synchronisé → ${state.mainBundle}`);
    } else {
      fail(`index.html désynchronisé :`);
      console.error(`${DIM}       attendu  : ${expected}`);
      console.error(`       trouvé   : ${srcInHtml}${RESET}`);
      fail('Lancer : npm run bundle:js  (met à jour index.html automatiquement)');
    }
  }
}

// ── Rapport final ─────────────────────────────────────────────────────
console.log('');

if (errors > 0) {
  const s = errors > 1 ? 's' : '';
  console.error(`${RED}${BOLD}✖  ${errors} erreur${s} — corrigez avant de committer.${RESET}\n`);
  process.exit(1);
}

if (warnings > 0) {
  console.log(`${YELLOW}✔  check:bundle — ${warnings} avertissement(s), aucune erreur bloquante.${RESET}\n`);
} else {
  console.log(`${GREEN}${BOLD}✅  bundle:js synchronisé avec index.html.${RESET}\n`);
}
