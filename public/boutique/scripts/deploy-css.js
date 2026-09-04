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
 *   1. Compile les bundles CSS dans css/dist/
 *   2. Calcule les hashes SHA-1 de chaque bundle
 *   3. Compare avec les hashes précédents (.cache-buster-state.json)
 *   4. Si un bundle a changé : bumpe son ?v=N dans son fichier propriétaire
 *      (index.html par défaut, loader JS explicite pour les bundles dynamiques)
 *   5. Met à jour le state avec les nouveaux hashes
 *   6. Bumpe la version du SW reset dans index.html si --sw-bump passé
 *
 * Différences clés vs l'ancien système :
 *   - Pas d'état intermédiaire : bundle + bump = une seule opération atomique
 *   - Chaque bundle a sa propre version indépendante (pas de version globale)
 *   - Les bundles chargés dynamiquement déclarent versionFile dans css-bundles.js
 *   - bumpVersion lit et modifie le propriétaire réel de chaque ?v=N
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

const { BUNDLES } = require('./css-bundles.js');

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

function versionOwnerPath(bundle) {
  return path.join(ROOT, bundle.versionFile || 'index.html');
}

/**
 * Lit le ?v=N courant d'UN bundle spécifique dans son contenu propriétaire.
 * Retourne le numéro (int) ou 1 si introuvable.
 */
function readBundleVersion(content, bundleName) {
  const re = new RegExp(`${bundleName.replace('.', '\\.')}\\?v=(\\d+)`, 'i');
  const m  = re.exec(content);
  return m ? parseInt(m[1], 10) : 1;
}

/**
 * Remplace ?v=N par ?v=N+1 pour UN bundle spécifique.
 * Ne touche pas les autres bundles.
 */
function bumpBundleVersion(content, bundleName, oldV, newV) {
  const re = new RegExp(
    `(${bundleName.replace('.', '\\.')}\\?v=)${oldV}`,
    'g'
  );
  return content.replace(re, `$1${newV}`);
}

// ── Étape 1 : Compilation des bundles ─────────────────────────────────────────

console.log(`\n${BOLD}${CYN}━━━ deploy-css — Komerce ━━━${R}`);
if (DRY)   console.log(`${YLW}Mode : --dry (aucun fichier modifié)${R}`);
if (FORCE) console.log(`${YLW}Mode : --force (bump inconditionnel)${R}`);
console.log('');

if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });

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
    `   KOMERCE — ${bundle.out}`,
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

  // Hash sur les SOURCES uniquement (pas le header) → déterministe.
  newHashes[bundle.out] = sha1(Buffer.from(parts.join('\n\n'), 'utf8'));
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
  console.log(`\n${GRN}${BOLD}✔ Aucun changement — versions inchangées.${R}\n`);
  process.exit(0);
}

console.log(`\n  ${YLW}${changed.length} bundle(s) modifié(s) : ${changed.join(', ')}${R}`);

// ── Étape 3 : Bump des versions dans leurs fichiers propriétaires ─────────────

console.log(`\n${BOLD}3. Bump des ?v= dans les propriétaires de version${R}`);

const ownerContents = new Map();
const newVersions = { ...(prevState.versions || {}) };

function getOwnerContent(ownerPath) {
  if (!ownerContents.has(ownerPath)) {
    ownerContents.set(ownerPath, fs.readFileSync(ownerPath, 'utf8'));
  }
  return ownerContents.get(ownerPath);
}

for (const bundle of BUNDLES.filter(item => changed.includes(item.out))) {
  const bundleName = bundle.out;
  const ownerPath = versionOwnerPath(bundle);
  const owner = getOwnerContent(ownerPath);
  const oldV = readBundleVersion(owner, bundleName);
  const newV = oldV + 1;
  const updated = bumpBundleVersion(owner, bundleName, oldV, newV);

  const check = readBundleVersion(updated, bundleName);
  if (check !== newV) {
    const ownerLabel = path.relative(ROOT, ownerPath);
    console.error(`${RED}✖ Échec du bump pour ${bundleName} (attendu v=${newV}, obtenu v=${check})${R}`);
    console.error(`${DIM}  Vérifier que ${ownerLabel} contient bien ${bundleName}?v=${oldV}${R}`);
    process.exit(1);
  }

  ownerContents.set(ownerPath, updated);
  newVersions[bundleName] = newV;
  console.log(`  ${GRN}✓${R}  ${bundleName.padEnd(24)} ?v=${oldV} → ?v=${newV} ${DIM}(${path.relative(ROOT, ownerPath)})${R}`);
}

// Bundles non modifiés : log de leur version dans leur propriétaire réel.
for (const bundle of BUNDLES) {
  if (!changed.includes(bundle.out)) {
    const ownerPath = versionOwnerPath(bundle);
    const content = getOwnerContent(ownerPath);
    const v = readBundleVersion(content, bundle.out);
    console.log(`  ${DIM}  ${bundle.out.padEnd(24)} ?v=${v} (inchangé)${R}`);
    newVersions[bundle.out] = v;
  }
}

// ── Étape 4 (optionnel) : bump SW reset ──────────────────────────────────────

if (SW_BUMP) {
  let html = getOwnerContent(INDEX_HTML);
  const swMatch = html.match(/sw_reset_v(\d+)/);
  if (swMatch) {
    const oldSW = parseInt(swMatch[1], 10);
    const newSW = oldSW + 1;
    html = html.replace(new RegExp(`sw_reset_v${oldSW}`, 'g'), `sw_reset_v${newSW}`);
    html = html.replace(new RegExp(`komerce-v${oldSW}`, 'g'), `komerce-v${newSW}`);
    ownerContents.set(INDEX_HTML, html);
    console.log(`\n  ${GRN}✓${R}  SW reset : v${oldSW} → v${newSW}`);
  }
}

// ── Étape 5 : Écriture ────────────────────────────────────────────────────────

if (!DRY) {
  for (const [ownerPath, content] of ownerContents.entries()) {
    fs.writeFileSync(ownerPath, content, 'utf8');
  }

  saveState({
    versions:    newVersions,
    hashes:      newHashes,
    updatedAt:   new Date().toISOString(),
    changedBundles: changed,
  });
}

// En mode --dry (check:cache), un bundle "modifié" = state périmé vs sources.
// On bloque : la règle « rebuild après modif source / dist jamais édité à la main »
// devient exécutable (et non plus seulement informative). En pre-commit, le hook
// régénère automatiquement, donc ce cas ne se présente qu'en bypass ou en CI.
if (DRY && changed.length > 0) {
  console.error(`\n${RED}${BOLD}✖ dist périmé : ${changed.length} bundle(s) à régénérer (${changed.join(', ')}).${R}`);
  console.error(`${DIM}  Lance : npm run deploy:css  puis recommite. (En pre-commit c'est automatique.)${R}\n`);
  process.exit(1);
}

console.log(`\n${GRN}${BOLD}✔ deploy-css terminé${DRY ? ' (dry-run — rien écrit)' : ''}.${R}`);
console.log(`${DIM}  Pensez à commiter les propriétaires de ?v= + .cache-buster-state.json.${R}\n`);
