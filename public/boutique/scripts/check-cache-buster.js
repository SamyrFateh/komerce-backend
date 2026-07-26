#!/usr/bin/env node
/**
 * check-cache-buster.js — Garde-fou cache CSS Komerce boutique
 * Version : 1.0 (2026-05-19)
 *
 * Vérifie et synchronise les query-strings `?v=N` dans index.html.
 *
 * Contexte (documenté dans CARTOGRAPHY_360_BOUTIQUE.md §2 piège P-9) :
 *   Le HTML charge les 4 bundles CSS avec un cache-buster statique :
 *     /boutique/css/dist/base.css?v=3
 *     /boutique/css/dist/components.css?v=3
 *     /boutique/css/dist/desktop.css?v=3
 *     /boutique/css/dist/event.css?v=3
 *   Si on modifie un fichier CSS source sans bumper ce numéro, les
 *   navigateurs utilisateurs continuent de charger l'ancienne version
 *   depuis leur cache — bugs CSS invisibles en prod mais pas en dev.
 *
 * Ce que ce script fait :
 *   C-1  Lit les 4 bundles dans css/dist/ et calcule leur hash (SHA-1 tronqué)
 *   C-2  Lit les ?v=N actuels dans index.html
 *   C-3  Compare : si un bundle a changé depuis le dernier enregistrement,
 *        le script détecte le désynchronisme
 *   C-4  En mode --fix : bumpe TOUS les ?v=N à N+1 dans index.html
 *        (toujours la même valeur pour les 4 bundles — cohérence)
 *   C-5  Écrit les hashes courants dans .cache-buster-state.json pour
 *        que le prochain run puisse détecter les changements
 *
 * Usage :
 *   node scripts/check-cache-buster.js           ← vérifie uniquement (exit 1 si désync)
 *   node scripts/check-cache-buster.js --fix      ← bumpe index.html + met à jour l'état
 *   node scripts/check-cache-buster.js --init     ← initialise l'état sans vérifier
 *   npm run check:cache                           ← vérifie uniquement (mode CI)
 *
 * Intégration recommandée :
 *   - En CI/precommit : `npm run check:cache` (mode vérification)
 *   - Après `npm run bundle:css` : `node scripts/check-cache-buster.js --fix`
 *
 * Sortie : exit 0 si en sync ou si --fix/--init réussit, exit 1 si désync.
 */
'use strict';

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// ────────────────────────────────────────────────────────────────────
// CONFIG
// ────────────────────────────────────────────────────────────────────

const ROOT      = path.resolve(__dirname, '..');
const DIST_DIR  = path.join(ROOT, 'css', 'dist');
const INDEX_HTML = path.join(ROOT, 'index.html');
const STATE_FILE = path.join(ROOT, '.cache-buster-state.json');

/** Les 4 bundles produits par bundle-css.js, dans l'ordre de index.html */
const BUNDLES = ['base.css', 'components.css', 'desktop.css'];

/** Taille du hash SHA-1 tronqué stocké dans le state */
const HASH_LENGTH = 12;

// ────────────────────────────────────────────────────────────────────
// COULEURS
// ────────────────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN  = '\x1b[32m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const CYAN   = '\x1b[36m';

// ────────────────────────────────────────────────────────────────────
// UTILITAIRES
// ────────────────────────────────────────────────────────────────────

function hashFile(filepath) {
  if (!fs.existsSync(filepath)) return null;
  const content = fs.readFileSync(filepath);
  return crypto.createHash('sha1').update(content).digest('hex').slice(0, HASH_LENGTH);
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/**
 * Lit le ?v=N courant dans index.html pour les bundles CSS.
 * Retourne { version: number, lines: Map<bundle, lineIndex> }
 */
function readCurrentVersion(src) {
  const lines   = src.split('\n');
  const found   = new Map(); // bundle → { version, lineIdx }
  let maxVersion = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const bundle of BUNDLES) {
      // Exemple: href="/boutique/css/dist/base.css?v=3"
      const re = new RegExp(`${bundle.replace('.', '\\.')}\\?v=(\\d+)`, 'i');
      const m  = re.exec(line);
      if (m) {
        const ver = parseInt(m[1], 10);
        found.set(bundle, { version: ver, lineIdx: i });
        if (ver > maxVersion) maxVersion = ver;
      }
    }
  }

  return { version: maxVersion, lines: found };
}

/**
 * Bumpe tous les ?v=N à N+newVersion dans index.html.
 * Retourne le nouveau contenu du fichier.
 */
function bumpVersion(src, oldVersion, newVersion) {
  let result = src;
  for (const bundle of BUNDLES) {
    const re = new RegExp(
      `(${bundle.replace('.', '\\.')}\\?v=)${oldVersion}`,
      'g'
    );
    result = result.replace(re, `$1${newVersion}`);
  }
  return result;
}

// ────────────────────────────────────────────────────────────────────
// MAIN
// ────────────────────────────────────────────────────────────────────

(function main() {
  const args   = process.argv.slice(2);
  const doFix  = args.includes('--fix');
  const doInit = args.includes('--init');

  console.log(`\n${BOLD}${CYAN}━━━ check-cache-buster — Komerce Boutique ━━━${RESET}`);
  if (doFix)  console.log(`${YELLOW}Mode : --fix (bump index.html + mise à jour état)${RESET}\n`);
  if (doInit) console.log(`${YELLOW}Mode : --init (initialisation de l'état sans vérification)${RESET}\n`);

  // Vérifie que les bundles existent
  const missing = BUNDLES.filter(b => !fs.existsSync(path.join(DIST_DIR, b)));
  if (missing.length > 0) {
    console.log(`${RED}✖ Bundles manquants dans css/dist/ :${RESET}`);
    for (const b of missing) console.log(`  ${DIM}↳ ${b}${RESET}`);
    console.log(`${DIM}Lancez d'abord : npm run bundle:css${RESET}\n`);
    process.exit(1);
  }

  // Calcule les hashes courants
  const currentHashes = {};
  for (const bundle of BUNDLES) {
    currentHashes[bundle] = hashFile(path.join(DIST_DIR, bundle));
  }

  console.log(`${BOLD}Hashes courants des bundles :${RESET}`);
  for (const [bundle, hash] of Object.entries(currentHashes)) {
    console.log(`  ${DIM}${bundle.padEnd(22)} ${hash}${RESET}`);
  }
  console.log();

  // Mode --init : initialiser l'état
  if (doInit) {
    const indexSrc = fs.readFileSync(INDEX_HTML, 'utf8');
    const { version } = readCurrentVersion(indexSrc);
    const state = {
      version,
      hashes: currentHashes,
      updatedAt: new Date().toISOString(),
    };
    saveState(state);
    console.log(`${GREEN}✔ État initialisé — version actuelle : v=${version}${RESET}`);
    console.log(`${DIM}Fichier : ${path.relative(ROOT, STATE_FILE)}${RESET}\n`);
    process.exit(0);
  }

  // Charge l'état précédent
  const prevState = loadState();

  if (!prevState) {
    console.log(`${YELLOW}⚠ Aucun état précédent trouvé (${path.relative(ROOT, STATE_FILE)}).${RESET}`);
    console.log(`${DIM}Lancez : node scripts/check-cache-buster.js --init${RESET}`);
    console.log(`${DIM}Le script ne peut pas détecter les changements sans baseline.${RESET}\n`);
    // Pas bloquant en CI si aucun état n'existe encore
    process.exit(0);
  }

  // Compare hashes courants vs hashes précédents
  const changed = [];
  for (const bundle of BUNDLES) {
    if (prevState.hashes[bundle] !== currentHashes[bundle]) {
      changed.push({
        bundle,
        prev: prevState.hashes[bundle] || '(inconnu)',
        curr: currentHashes[bundle],
      });
    }
  }

  // Lit la version actuelle dans index.html
  const indexSrc    = fs.readFileSync(INDEX_HTML, 'utf8');
  const { version, lines: versionLines } = readCurrentVersion(indexSrc);

  if (versionLines.size === 0) {
    console.log(`${RED}✖ Aucun bundle trouvé dans index.html avec pattern ?v=N.${RESET}`);
    console.log(`${DIM}Vérifiez les lignes <link rel="stylesheet" href="...?v=N"> dans index.html.${RESET}\n`);
    process.exit(1);
  }

  // Vérifie la cohérence des versions dans index.html (toutes doivent être identiques)
  const allVersions = new Set([...versionLines.values()].map(v => v.version));
  if (allVersions.size > 1) {
    console.log(`${YELLOW}⚠ Versions incohérentes dans index.html :${RESET}`);
    for (const [bundle, info] of versionLines) {
      console.log(`  ${DIM}${bundle} → ?v=${info.version} (ligne ${info.lineIdx + 1})${RESET}`);
    }
    console.log(`${DIM}Le --fix va les aligner toutes sur la même valeur.${RESET}\n`);
  } else {
    console.log(`${BOLD}Version actuelle dans index.html : ${GREEN}?v=${version}${RESET}`);
    console.log(`${DIM}Référencé sur ${versionLines.size} bundle(s)${RESET}\n`);
  }

  if (changed.length === 0) {
    console.log(`${GREEN}${BOLD}✔ Tous les bundles CSS sont en sync avec le cache-buster.${RESET}`);
    console.log(`${DIM}  Version index.html : ?v=${version} — aucun changement détecté.${RESET}\n`);
    process.exit(0);
  }

  // Des bundles ont changé
  console.log(`${RED}${BOLD}✖ ${changed.length} bundle(s) ont changé depuis le dernier état :${RESET}`);
  for (const c of changed) {
    console.log(`  ${RED}↳${RESET} ${BOLD}${c.bundle}${RESET}`);
    console.log(`    ${DIM}Précédent : ${c.prev}${RESET}`);
    console.log(`    ${DIM}Courant   : ${c.curr}${RESET}`);
  }
  console.log();
  console.log(`${YELLOW}⚠ index.html utilise toujours ?v=${version} mais les bundles ont changé.${RESET}`);
  console.log(`${DIM}Les utilisateurs avec cache conserveront l'ancienne version CSS.${RESET}\n`);

  if (!doFix) {
    console.log(`${DIM}Lancez : node scripts/check-cache-buster.js --fix${RESET}`);
    console.log(`${DIM}pour bumper automatiquement index.html à ?v=${version + 1}.${RESET}\n`);
    process.exit(1);
  }

  // ── Mode --fix ──────────────────────────────────────────────────
  const newVersion   = version + 1;
  const newIndexSrc  = bumpVersion(indexSrc, version, newVersion);

  // Vérification : les 4 bundles ont bien été mis à jour
  const { version: checkVersion, lines: checkLines } = readCurrentVersion(newIndexSrc);
  if (checkVersion !== newVersion || checkLines.size !== BUNDLES.length) {
    console.log(`${RED}✖ Échec du bump : vérification post-remplacement échouée.${RESET}`);
    console.log(`${DIM}Version attendue : ?v=${newVersion}, obtenue : ?v=${checkVersion}${RESET}`);
    console.log(`${DIM}Bundles trouvés : ${checkLines.size}/${BUNDLES.length}${RESET}\n`);
    process.exit(1);
  }

  fs.writeFileSync(INDEX_HTML, newIndexSrc, 'utf8');

  const newState = {
    version:   newVersion,
    hashes:    currentHashes,
    updatedAt: new Date().toISOString(),
    bumpedFrom: version,
    reason: `${changed.length} bundle(s) modifié(s) : ${changed.map(c => c.bundle).join(', ')}`,
  };
  saveState(newState);

  console.log(`${GREEN}${BOLD}✔ index.html mis à jour : ?v=${version} → ?v=${newVersion}${RESET}`);
  for (const c of changed) {
    console.log(`  ${DIM}↳ ${c.bundle} : ${c.prev} → ${c.curr}${RESET}`);
  }
  console.log(`${DIM}État sauvegardé dans ${path.relative(ROOT, STATE_FILE)}${RESET}`);
  console.log(`${YELLOW}⚠ Pensez à commiter index.html et .cache-buster-state.json.${RESET}\n`);
  process.exit(0);
})();
