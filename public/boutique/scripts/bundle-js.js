#!/usr/bin/env node
/**
 * bundle-js.js — Komerce JS bundler (ARCH-3)
 * Version : 1.0 (2026-05-30)
 *
 * Construit un bundle ES depuis js/main.js via esbuild.
 * Produit js/dist/ avec hash de contenu dans les noms de fichiers (prod)
 * ou sans hash (dev).
 * Met à jour index.html automatiquement.
 *
 * Invariants conservés :
 *   I-7  Le bundle est toujours régénéré avant commit (check:bundle valide)
 *   I-8  komerce-api.js reste hors bundle (script classique window.K)
 *   I-9  Les import() dynamiques restent des chunks séparés (--splitting)
 *
 * Usage :
 *   node scripts/bundle-js.js              ← prod : minifié, hashé
 *   node scripts/bundle-js.js --dev        ← dev  : sourcemaps, non-minifié
 *   node scripts/bundle-js.js --dev --watch ← dev watch
 *   npm run bundle:js                      ← prod
 *   npm run bundle:js:dev                  ← dev
 *   npm run bundle:js:watch                ← dev watch
 *
 * Sortie : exit 0 si succès, exit 1 si erreur.
 */

'use strict';

const { execSync } = require('child_process');
const fs           = require('fs');
const path         = require('path');

// ────────────────────────────────────────────────────────────────────
// CONFIG
// ────────────────────────────────────────────────────────────────────

const ROOT       = path.resolve(__dirname, '..');
const JS_DIR     = path.join(ROOT, 'js');
const OUT_DIR    = path.join(JS_DIR, 'dist');
const STATE_FILE = path.join(OUT_DIR, '.bundle-state.json');
const INDEX_HTML = path.join(ROOT, 'index.html');
const ENTRY      = path.join(JS_DIR, 'main.js');

/** Taille minimale du bundle principal en prod (octets) — guard anti-build cassé */
const MIN_BUNDLE_BYTES = 50_000;

const isDev   = process.argv.includes('--dev');
const isWatch = process.argv.includes('--watch');

// ────────────────────────────────────────────────────────────────────
// COULEURS (cohérent avec check-cache-buster.js)
// ────────────────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN  = '\x1b[32m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const CYAN   = '\x1b[36m';

function log(msg)  { console.log(msg); }
function ok(msg)   { console.log(`${GREEN}  ✔${RESET}  ${msg}`); }
function warn(msg) { console.warn(`${YELLOW}  ⚠${RESET}  ${msg}`); }
function fail(msg) { console.error(`${RED}  ✖${RESET}  ${msg}`); }

// ────────────────────────────────────────────────────────────────────
// 1. RÉSOUDRE ESBUILD
// ────────────────────────────────────────────────────────────────────

let esbuildBin;
try {
  // Cherche esbuild installé localement dans node_modules
  esbuildBin = require.resolve('esbuild/bin/esbuild');
} catch {
  fail('esbuild introuvable dans node_modules.');
  fail('Lancer : npm install --save-dev esbuild');
  process.exit(1);
}

// ────────────────────────────────────────────────────────────────────
// 2. PRÉPARER LE DOSSIER DE SORTIE
// ────────────────────────────────────────────────────────────────────

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

// Sauvegarder l'ancien state avant de vider (pour restaurer si build échoue)
let previousState = null;
if (fs.existsSync(STATE_FILE)) {
  try { previousState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { /* ok */ }
}

// Vider les anciens bundles (pas le state — il est restauré en cas d'échec)
for (const entry of fs.readdirSync(OUT_DIR)) {
  if (entry === '.bundle-state.json') continue;
  fs.rmSync(path.join(OUT_DIR, entry), { recursive: true, force: true });
}

// ────────────────────────────────────────────────────────────────────
// 3. CONSTRUIRE LA COMMANDE ESBUILD
// ────────────────────────────────────────────────────────────────────

// En prod  : noms hashés  → main-a3f2c1b8.js
// En dev   : noms simples → main.js
// Chunks lazy : toujours dans chunks/[name]-[hash].js (stable)

const cmd = [
  `node "${esbuildBin}"`,
  `"${ENTRY}"`,
  '--bundle',
  '--format=esm',
  '--splitting',                         // I-9 : import() dynamiques → chunks séparés
  `--outdir="${OUT_DIR}"`,
  `--chunk-names=chunks/[name]-[hash]`,  // chunks lazy toujours hashés
  isDev ? '--entry-names=[name]' : '--entry-names=[name]-[hash]',
  '--target=es2020',
  isDev  ? '--sourcemap' : '--minify',
  isWatch ? '--watch' : '',
  // I-8 : komerce-api.js est window.K — external (ne jamais bundler)
  // On marque 'komerce-api' comme external via une URL fictive ;
  // dans la pratique aucun module ES n'importe komerce-api, donc cette
  // ligne est défensive uniquement.
  '--external:*/komerce-api.js',
].filter(Boolean).join(' ');

// ────────────────────────────────────────────────────────────────────
// 4. EXÉCUTER ESBUILD
// ────────────────────────────────────────────────────────────────────

log(`\n${BOLD}📦 bundle:js${RESET} — mode ${isDev ? `${CYAN}DEV${RESET}` : `${GREEN}PROD${RESET}`}`);
log(`${DIM}   entry  : js/main.js`);
log(`   outdir : js/dist/${RESET}\n`);

try {
  execSync(cmd, { stdio: 'inherit', cwd: ROOT });
} catch {
  fail('esbuild a échoué — voir les erreurs ci-dessus.');
  // Restaurer l'ancien state si disponible
  if (previousState) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(previousState, null, 2) + '\n', 'utf8');
    warn('State précédent restauré dans .bundle-state.json.');
  }
  process.exit(1);
}

// En mode watch, esbuild tient le processus — on sort ici
if (isWatch) process.exit(0);

// ────────────────────────────────────────────────────────────────────
// 5. TROUVER LE BUNDLE PRINCIPAL PRODUIT
// ────────────────────────────────────────────────────────────────────

const bundleFiles = fs.readdirSync(OUT_DIR)
  .filter(f => f.startsWith('main') && f.endsWith('.js'));

if (bundleFiles.length === 0) {
  fail('Aucun fichier main*.js trouvé dans js/dist/ après le build.');
  process.exit(1);
}
if (bundleFiles.length > 1) {
  warn(`Plusieurs fichiers main*.js dans js/dist/ — utilisation du plus récent.`);
  bundleFiles.sort((a, b) => {
    return fs.statSync(path.join(OUT_DIR, b)).mtimeMs
         - fs.statSync(path.join(OUT_DIR, a)).mtimeMs;
  });
}
const mainBundle = bundleFiles[0];
const mainPath   = path.join(OUT_DIR, mainBundle);
const mainSize   = fs.statSync(mainPath).size;

// Guard : bundle trop petit = build cassé
if (mainSize < MIN_BUNDLE_BYTES) {
  fail(`Bundle principal trop petit : ${mainSize} octets (min : ${MIN_BUNDLE_BYTES}).`);
  fail("Vérifier que js/main.js est bien le bon point d'entree.");
  process.exit(1);
}

ok(`Bundle principal : ${BOLD}${mainBundle}${RESET} (${Math.round(mainSize / 1024)} KB)`);

// ────────────────────────────────────────────────────────────────────
// 6. METTRE À JOUR INDEX.HTML
// ────────────────────────────────────────────────────────────────────

let html = fs.readFileSync(INDEX_HTML, 'utf8');

// Regex : capture la balise <script type="module" src="...">
// Tolère les attributs dans n'importe quel ordre
const scriptRegex = /(<script\b[^>]*\btype="module"[^>]*\bsrc=")[^"]*(")/;

if (!scriptRegex.test(html)) {
  fail('Balise <script type="module" src="..."> introuvable dans index.html.');
  fail('Vérifier la ligne contenant main.js dans index.html.');
  process.exit(1);
}

const newSrc = `/boutique/js/dist/${mainBundle}`;
const oldMatch = html.match(scriptRegex);
const oldSrc = oldMatch ? oldMatch[0].match(/src="([^"]+)"/)?.[1] : '(introuvable)';

html = html.replace(scriptRegex, `$1${newSrc}$2`);
fs.writeFileSync(INDEX_HTML, html, 'utf8');

if (oldSrc === newSrc) {
  ok(`index.html inchangé (même bundle)`);
} else {
  ok(`index.html mis à jour`);
  log(`${DIM}   ${oldSrc}${RESET}`);
  log(`${DIM}   → ${newSrc}${RESET}`);
}

// ────────────────────────────────────────────────────────────────────
// 7. INVENTORIER LES CHUNKS ET ÉCRIRE .bundle-state.json
// ────────────────────────────────────────────────────────────────────

function collectJsFiles(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { result.push(...collectJsFiles(full)); continue; }
    if (entry.name.endsWith('.js')) result.push(full);
  }
  return result;
}

const allJs     = collectJsFiles(OUT_DIR).filter(f => !f.endsWith('.bundle-state.json'));
const totalBytes = allJs.reduce((acc, f) => acc + fs.statSync(f).size, 0);

const chunks = allJs.map(f => ({
  file  : path.relative(ROOT, f).replace(/\\/g, '/'),
  sizeKB: Math.round(fs.statSync(f).size / 1024),
})).sort((a, b) => b.sizeKB - a.sizeKB);

const state = {
  mode          : isDev ? 'dev' : 'prod',
  mainBundle,
  totalBundleKB : Math.round(totalBytes / 1024),
  chunks,
  updatedAt     : new Date().toISOString(),
};

fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');

// ────────────────────────────────────────────────────────────────────
// 8. RAPPORT FINAL
// ────────────────────────────────────────────────────────────────────

const lazyCount = chunks.filter(c => c.file.includes('/chunks/')).length;

log('');
log(`${GREEN}${BOLD}✅  bundle:js terminé${RESET}`);
log(`${DIM}   bundle principal : ${mainBundle} (${Math.round(mainSize / 1024)} KB)`);
log(`   total JS dist    : ${state.totalBundleKB} KB`);
log(`   chunks lazy      : ${lazyCount}`);
if (!isDev) {
  const savings = previousState
    ? ` (était ${previousState.totalBundleKB} KB)`
    : '';
  log(`   mode prod        : minifié${savings}`);
}
log(RESET);
