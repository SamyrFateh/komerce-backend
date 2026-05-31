#!/usr/bin/env node
/**
 * deploy-css.js — Komerce CSS deploy (remplace bundle-css + check-cache-buster)
 *
 * Usage :
 *   node scripts/deploy-css.js          ← bundle + bump si changement
 *   node scripts/deploy-css.js --force  ← bundle + bump inconditionnellement
 *   node scripts/deploy-css.js --dry    ← affiche ce qui changerait, ne touche rien
 *
 * Ce que ça fait en UNE commande :
 *   1. Compile les 4 bundles CSS dans css/dist/
 *   2. Calcule les hashes SHA-1 de chaque bundle
 *   3. Compare avec les hashes précédents (.cache-buster-state.json)
 *   4. Si un bundle a changé : bumpe CHAQUE ?v=N individuellement dans index.html
 *   5. Met à jour le state avec les nouveaux hashes
 *   6. Bumpe la version du SW reset dans index.html si --sw-bump passé
 *
 * Différences clés vs l'ancien système :
 *   - Pas d'état intermédiaire : bundle + bump = une seule opération atomique
 *   - Chaque bundle a sa propre version indépendante (pas de version globale)
 *   - bumpVersion ne dépend pas d'une "version max" — il lit la version courante
 *     de CHAQUE bundle et la bumpe individuellement
 *   - Aucune édition manuelle de index.html ne peut casser le système
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// ── Config ────────────────────────────────────────────────────────────────────

const ROOT       = path.resolve(__dirname, '..');
const CSS_DIR    = path.join(ROOT, 'css');
const DIST_DIR   = path.join(CSS_DIR, 'dist');
const INDEX_HTML = path.join(ROOT, 'index.html');
const STATE_FILE = path.join(ROOT, '.cache-buster-state.json');
const HASH_LEN   = 12;

const BUNDLES = [
  {
    out: 'base.css',
    files: ['tokens', 'reset', 'layout', 'hero'],
  },
  {
    out: 'components.css',
    files: ['categories', 'products', 'modal-shell', 'modal-media', 'modal-product',
            'cart', 'interactions', 'hero-cart-proxy', 'group-cart-flow', 'shared-followup', 'identity'],
  },
  {
    out: 'desktop.css',
    files: ['boutique-desktop', 'desktop-commerce-skeleton'],
  },
  {
    out: 'event.css',
    files: ['tokens', 'event'],
  },
];

const MIN_BUNDLE_BYTES = 1000;

// ── Couleurs ──────────────────────────────────────────────────────────────────

const R = '\x1b[0m';
const RED   = '\x1b[31m';
const GRN   = '\x1b[32m';
const YLW   = '\x1b[33m';
const CYN   = '\x1b[36m';
const BOLD  = '\x1b[1m';
const DIM   = '\x1b[2m';

// ── Utilitaires ───────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const FORCE   = args.includes('--force');
const DRY     = args.includes('--dry');
const SW_BUMP = args.includes('--sw-bump');

function sha1(content) {
  return crypto.createHash('sha1').update(content).digest('hex').slice(0, HASH_LEN);
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { versions: {}, hashes: {} }; }
}

function saveState(state) {
  if (!DRY) fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/**
 * Lit le ?v=N courant d'UN bundle spécifique dans le HTML.
 * Retourne le numéro (int) ou 1 si introuvable.
 */
function readBundleVersion(html, bundleName) {
  const re = new RegExp(`${bundleName.replace('.', '\\.')}\\?v=(\\d+)`, 'i');
  const m  = re.exec(html);
  return m ? parseInt(m[1], 10) : 1;
}

/**
 * Remplace ?v=N par ?v=N+1 pour UN bundle spécifique.
 * Ne touche pas les autres bundles.
 */
function bumpBundleVersion(html, bundleName, oldV, newV) {
  const re = new RegExp(
    `(${bundleName.replace('.', '\\.')}\\?v=)${oldV}`,
    'g'
  );
  return html.replace(re, `$1${newV}`);
}

// ── Étape 1 : Compilation des bundles ─────────────────────────────────────────

console.log(`\n${BOLD}${CYN}━━━ deploy-css — Komerce ━━━${R}`);
if (DRY)   console.log(`${YLW}Mode : --dry (aucun fichier modifié)${R}`);
if (FORCE) console.log(`${YLW}Mode : --force (bump inconditionnel)${R}`);
console.log('');

if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });

const stamp = new Date().toISOString().slice(0, 10);
const newHashes = {};

console.log(`${BOLD}1. Compilation des bundles${R}`);

for (const bundle of BUNDLES) {
  const parts = bundle.files.map(name => {
    const src = path.join(CSS_DIR, `${name}.css`);
    if (!fs.existsSync(src)) {
      console.warn(`  ${YLW}⚠ introuvable : ${name}.css${R}`);
      return '';
    }
    return `/* ── ${name}.css ${'─'.repeat(Math.max(0, 50 - name.length))} */\n${fs.readFileSync(src, 'utf8')}`;
  });

  const header = [
    `/* ${'═'.repeat(63)}`,
    `   KOMERCE — ${bundle.out} (${stamp})`,
    `   Généré par deploy-css.js — éditer les sources CSS.`,
    `   ${'═'.repeat(63)} */`,
    '',
  ].join('\n');

  const output = header + parts.join('\n\n');
  const dest   = path.join(DIST_DIR, bundle.out);

  if (!DRY) fs.writeFileSync(dest, output, 'utf8');

  const size = Buffer.byteLength(output, 'utf8');
  if (size < MIN_BUNDLE_BYTES) {
    console.error(`${RED}✖ ${bundle.out} trop petit (${size} octets) — vérifier les sources${R}`);
    process.exit(1);
  }

  newHashes[bundle.out] = sha1(Buffer.from(output, 'utf8'));
  console.log(`  ${GRN}✓${R}  ${bundle.out.padEnd(18)} ${(output.split('\n').length + ' lignes').padEnd(12)} ${DIM}← ${bundle.files.join(' + ')}${R}`);
}

// ── Étape 2 : Détection des changements ───────────────────────────────────────

console.log(`\n${BOLD}2. Détection des changements${R}`);

const prevState = loadState();
const changed   = [];

for (const bundle of BUNDLES) {
  const prev = prevState.hashes?.[bundle.out];
  const curr = newHashes[bundle.out];
  const hasChanged = FORCE || (prev !== curr);
  const mark = hasChanged ? `${YLW}↑ modifié${R}` : `${GRN}= identique${R}`;
  console.log(`  ${bundle.out.padEnd(18)} ${DIM}${curr}${R}  ${mark}`);
  if (hasChanged) changed.push(bundle.out);
}

if (changed.length === 0) {
  console.log(`\n${GRN}${BOLD}✔ Aucun changement — index.html inchangé.${R}\n`);
  process.exit(0);
}

console.log(`\n  ${YLW}${changed.length} bundle(s) modifié(s) : ${changed.join(', ')}${R}`);

// ── Étape 3 : Bump des versions dans index.html ───────────────────────────────

console.log(`\n${BOLD}3. Bump des ?v= dans index.html${R}`);

let html = fs.readFileSync(INDEX_HTML, 'utf8');
const newVersions = { ...(prevState.versions || {}) };

for (const bundleName of changed) {
  const oldV = readBundleVersion(html, bundleName);
  const newV = oldV + 1;
  const updated = bumpBundleVersion(html, bundleName, oldV, newV);

  // Vérification : le remplacement a bien eu lieu
  const check = readBundleVersion(updated, bundleName);
  if (check !== newV) {
    console.error(`${RED}✖ Échec du bump pour ${bundleName} (attendu v=${newV}, obtenu v=${check})${R}`);
    console.error(`${DIM}  Vérifier que index.html contient bien ${bundleName}?v=${oldV}${R}`);
    process.exit(1);
  }

  html = updated;
  newVersions[bundleName] = newV;
  console.log(`  ${GRN}✓${R}  ${bundleName.padEnd(18)} ?v=${oldV} → ?v=${newV}`);
}

// Bundles non modifiés : on log juste leur version courante
for (const bundle of BUNDLES) {
  if (!changed.includes(bundle.out)) {
    const v = readBundleVersion(html, bundle.out);
    console.log(`  ${DIM}  ${bundle.out.padEnd(18)} ?v=${v} (inchangé)${R}`);
    newVersions[bundle.out] = v;
  }
}

// ── Étape 4 (optionnel) : bump SW reset ──────────────────────────────────────

if (SW_BUMP) {
  const swMatch = html.match(/sw_reset_v(\d+)/);
  if (swMatch) {
    const oldSW = parseInt(swMatch[1], 10);
    const newSW = oldSW + 1;
    html = html.replace(new RegExp(`sw_reset_v${oldSW}`, 'g'), `sw_reset_v${newSW}`);
    html = html.replace(new RegExp(`komerce-v${oldSW}`, 'g'), `komerce-v${newSW}`);
    console.log(`\n  ${GRN}✓${R}  SW reset : v${oldSW} → v${newSW}`);
  }
}

// ── Étape 5 : Écriture ────────────────────────────────────────────────────────

if (!DRY) {
  fs.writeFileSync(INDEX_HTML, html, 'utf8');

  saveState({
    versions:    newVersions,
    hashes:      newHashes,
    updatedAt:   new Date().toISOString(),
    changedBundles: changed,
  });
}

console.log(`\n${GRN}${BOLD}✔ deploy-css terminé${DRY ? ' (dry-run — rien écrit)' : ''}.${R}`);
console.log(`${DIM}  Pensez à commiter : index.html + .cache-buster-state.json${R}\n`);
