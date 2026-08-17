#!/usr/bin/env node
/**
 * ============================================================
 * KOMERCE — Feature Slice Guard
 * Version 1.0.0 · 2026-06
 * 0 dépendances externes — Node.js >= 18
 * Doctrine : docs/doctrine/FEATURE_SLICE_DOCTRINE.md
 * ============================================================
 *
 * Usage :
 *   node scripts/feature-guard.js                          # rapport complet
 *   node scripts/feature-guard.js --strict                 # exit(1) si écart
 *   node scripts/feature-guard.js --feature shared-cart    # un seul slice
 *   node scripts/feature-guard.js --save                   # fige la baseline
 *   node scripts/feature-guard.js --json                   # sortie JSON
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Racine repo ───────────────────────────────────────────────────────────────
const ROOT         = path.resolve(__dirname, '..');
const FEATURES_DIR = path.join(ROOT, 'features');
const BASELINE_FILE = path.join(__dirname, 'feature-guard-baseline.json');
const MIGRATION_SLOT_EXEMPTIONS_FILE = path.join(ROOT, 'governance', 'migration-slot-exemptions.json');
const MIGRATION_GUARD_EXEMPTIONS_FILE = path.join(ROOT, 'governance', 'migration-guard-exemptions.json');

/**
 * Créneaux de migration exemptés (accidents historiques déjà appliqués en
 * prod, cf. governance/migration-slot-exemptions.json). Une exemption ne
 * supprime pas la vérification pour tout le monde — elle ne couvre que les
 * fichiers exacts listés pour le créneau exact listé.
 */
function loadMigrationSlotExemptions() {
  try {
    const raw = JSON.parse(fs.readFileSync(MIGRATION_SLOT_EXEMPTIONS_FILE, 'utf8'));
    const map = new Map(); // slot → Set(files exemptés)
    for (const [slot, entry] of Object.entries(raw)) {
      if (slot.startsWith('_')) continue;
      map.set(slot, new Set(entry.files || []));
    }
    return map;
  } catch {
    return new Map();
  }
}
const MIGRATION_SLOT_EXEMPTIONS = loadMigrationSlotExemptions();

/**
 * Exemptions supplémentaires : fichiers sans préfixe numérique connus,
 * et gaps inter-feature documentés (cf. governance/migration-guard-exemptions.json).
 */
function loadMigrationGuardExemptions() {
  try {
    const raw = JSON.parse(fs.readFileSync(MIGRATION_GUARD_EXEMPTIONS_FILE, 'utf8'));
    return {
      noPrefix: new Set((raw.no_prefix || {}).files || []),
      gaps: Object.values(raw.gaps || {}).map(g => ({ feature: g.feature, from: g.from, to: g.to })),
    };
  } catch {
    return { noPrefix: new Set(), gaps: [] };
  }
}
const MIGRATION_GUARD_EXEMPTIONS = loadMigrationGuardExemptions();

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = (() => {
  const a = { strict: false, save: false, json: false, feature: null };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--strict')               a.strict = true;
    else if (arg === '--save')            a.save   = true;
    else if (arg === '--json')            a.json   = true;
    else if (arg.startsWith('--feature=')) a.feature = arg.split('=')[1];
    else if (arg === '--feature')         a.feature = process.argv[process.argv.indexOf(arg) + 1];
    else if (arg === '--help' || arg === '-h') { printHelp(); process.exit(0); }
  }
  return a;
})();

function printHelp() {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║  KOMERCE — Feature Slice Guard v1.0                     ║
╚══════════════════════════════════════════════════════════╝

Usage :
  node scripts/feature-guard.js [options]

Options :
  --feature <name>    Vérifie un seul slice (ex: --feature shared-cart)
  --strict            exit(1) si au moins un écart détecté (CI / pre-commit)
  --save              Fige la baseline (usage: après résolution des dettes)
  --json              Sortie JSON sur stdout
  --help, -h          Affiche cette aide

Doctrine : docs/doctrine/FEATURE_SLICE_DOCTRINE.md
`);
}

// ── Lecture des slices ────────────────────────────────────────────────────────
function loadSlices() {
  if (!fs.existsSync(FEATURES_DIR)) {
    console.error(`❌ Répertoire features/ absent (${FEATURES_DIR})`);
    console.error('   Créer features/ et au moins un *.feature.js pour commencer.');
    process.exit(1);
  }

  const files = fs.readdirSync(FEATURES_DIR)
    .filter(f => f.endsWith('.feature.js'))
    .sort();

  if (files.length === 0) {
    console.warn('⚠️  Aucun slice trouvé dans features/');
    process.exit(0);
  }

  const slices = [];
  for (const file of files) {
    try {
      const slice = require(path.join(FEATURES_DIR, file));
      slice._file = file;
      slices.push(slice);
    } catch (err) {
      console.error(`❌ Erreur de lecture du slice ${file} :`, err.message);
      process.exit(1);
    }
  }
  return slices;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

// Les fichiers déclarés en catégorie `boutique` / `dash` dans files.* sont
// relatifs à leur racine front (public/boutique, public/), pas à la racine
// repo. Sans ce préfixe, exists() cherchait "ROOT/js/b-catalog.js" au lieu de
// "ROOT/public/boutique/js/b-catalog.js" -> faux "absent du disque" sur la
// quasi-totalité des fichiers boutique/dash déclarés (22 + 8 sur 33 erreurs
// observées avant correctif).
const CATEGORY_PREFIX = { boutique: 'public/boutique', dash: 'public' };
function resolveRel(category, rel) {
  const prefix = CATEGORY_PREFIX[category];
  return prefix ? `${prefix}/${rel}` : rel;
}

/**
 * Extrait le numéro de préfixe d'un fichier migration.
 * "migrations/044_shared_cart.sql" → 44
 * "migrations/073a_shared_cart.sql" → 73  (lettre ignorée pour la séquentialité)
 */
/**
 * Clé de comparaison pour le rattachement fichier↔test (check 5).
 * Prend le nom de fichier SANS aucune extension (pas seulement le ".js"
 * final, pour gérer les extensions composées comme ".prompt.js" ou
 * ".base.js") et unifie "_" et "-" pour gérer les conventions de nommage
 * mixtes entre fichiers source (ex. "_helpers.js") et fichiers de test
 * (ex. "foo-helpers.test.js").
 */
function testBaseKey(rel) {
  const fname   = path.basename(rel);
  const firstDot = fname.indexOf('.');
  const stem    = firstDot === -1 ? fname : fname.slice(0, firstDot);
  return stem.replace(/^_+/, '').replace(/_/g, '-'); // strip leading _ (ex: _connector-utils → connector-utils)
}

function migrationNum(rel) {
  const base = path.basename(rel);
  const m = base.match(/^(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  // Ignorer les numéros qui ressemblent à des années (> 999) — convention de nommage exceptionnelle
  return n > 999 ? null : n;
}

/**
 * Créneau de migration pour la détection de collision — inclut le suffixe
 * lettre (ex. "071b") s'il existe. Décision de gouvernance 2026-07-06 :
 * Komerce numérote ses migrations par feature, pas globalement ; un même
 * numéro de base peut légitimement porter plusieurs migrations-sœurs
 * distinctes dans des features différentes, désambiguïsées par un suffixe
 * lettre (071_relay_dashboard_tables.sql vs 071b_shared_cart_commitments.sql).
 * Les deux sont déjà hashées et appliquées (governance/migration-hashes.json)
 * — ce ne sont pas des doublons, donc pas une collision au sens de ce gate.
 * Une vraie collision reste détectée : deux fichiers avec EXACTEMENT le même
 * créneau (même numéro ET même suffixe, ou absence de suffixe des deux côtés).
 */
function migrationSlot(rel) {
  const base = path.basename(rel);
  const m = base.match(/^(\d+[a-z]?)_/);
  return m ? m[1] : null;
}

/** Lit le @domain déclaré dans le header @komerce-arch d'un fichier. */
function readHeaderDomain(rel) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return null;
  try {
    const src = fs.readFileSync(full, 'utf8');
    const m = src.match(/@domain\s+([^\s\n*]+)/);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

/** Parcourt récursivement un répertoire et retourne les fichiers .js/.css. */
function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && !['node_modules', '.git', 'dist', 'chunks'].includes(e.name)) {
      walk(full, acc);
    } else if (e.isFile()) {
      acc.push(path.relative(ROOT, full).replace(/\\/g, '/'));
    }
  }
  return acc;
}

/** Vérifie si un fichier est importé (require/import) depuis des fichiers hors périmètre. */
function findImporters(rel, allPeriFiles) {
  const basename = path.basename(rel, path.extname(rel));
  const importers = [];
  // Scan services, routes, utils, middleware
  const scanDirs = ['services', 'routes', 'utils', 'middleware', 'core'];
  for (const dir of scanDirs) {
    const dirPath = path.join(ROOT, dir);
    if (!fs.existsSync(dirPath)) continue;
    for (const file of walk(dirPath)) {
      if (allPeriFiles.has(file)) continue; // dans le périmètre — OK
      try {
        const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
        // require('./shared-cart-engine') or require('../services/shared-cart-engine')
        if (src.includes(`'${basename}'`) || src.includes(`"${basename}"`) ||
            src.includes(`/${basename}'`) || src.includes(`/${basename}"`)) {
          importers.push(file);
        }
      } catch { /* skip */ }
    }
  }
  return importers;
}

// ── Vérification d'un slice ────────────────────────────────────────────────────
function checkSlice(slice, allMigSlots) {
  const errors   = [];
  const warnings = [];
  const name     = slice.name || slice._file;
  const status   = slice.status || 'draft';

  // ── 1. Champs obligatoires ───────────────────────────────────────────────
  for (const field of ['name', 'domain', 'status', 'owner', 'files']) {
    if (!slice[field]) errors.push(`Champ obligatoire manquant : "${field}"`);
  }
  if (!['draft', 'staging', 'production', 'deprecated'].includes(status)) {
    errors.push(`Status invalide : "${status}" — doit être draft | staging | production | deprecated`);
  }

  if (!slice.files) return { name, status, errors, warnings }; // pas de périmètre : arrêt

  // ── 2. Fichiers déclarés existent ────────────────────────────────────────
  const allDeclared = [];
  for (const [category, files] of Object.entries(slice.files)) {
    if (!Array.isArray(files)) { errors.push(`files.${category} doit être un tableau`); continue; }
    for (const rel of files) {
      const fullRel = resolveRel(category, rel);
      allDeclared.push(fullRel);
      if (!exists(fullRel)) {
        errors.push(`Fichier déclaré absent du disque [${category}] : ${rel}`);
      }
    }
  }

  const periSet = new Set(allDeclared);

  // ── 3. Migrations — collision de créneau (numéro + suffixe lettre) ──────
  const myMigSlots = new Set();
  for (const rel of (slice.files.migrations || [])) {
    const slot = migrationSlot(rel);
    if (slot === null) {
      if (!MIGRATION_GUARD_EXEMPTIONS.noPrefix.has(rel)) {
        warnings.push(`Migration sans numéro de préfixe : ${rel}`);
      }
      continue;
    }
    if (allMigSlots.has(slot) && !myMigSlots.has(slot)) {
      const exempted = MIGRATION_SLOT_EXEMPTIONS.get(slot);
      if (exempted && exempted.has(rel)) {
        // Collision documentée et exemptée → silencieux (voir governance/migration-slot-exemptions.json)
      } else {
        errors.push(`Collision créneau migration ${slot} avec un autre slice : ${rel}`);
      }
    }
    myMigSlots.add(slot);
    allMigSlots.add(slot);
  }

  // ── 4. Migrations — convention de créneaux repo-wide ───────────────────
  // Komerce ne numérote PAS les migrations de façon dense par feature. Une
  // feature peut légitimement passer de 086 à 131 parce que les créneaux
  // intermédiaires appartiennent à d'autres features. La collision exacte de
  // créneau est déjà vérifiée ci-dessus ; l'ordre/hash/applicabilité sont
  // couverts par les gates migration/schema dédiées. Un "gap > 20" n'est
  // donc ni une dette ni un warning exploitable et ne doit pas être émis ici.

  // ── 5. Couverture tests structurelle (staging+) ──────────────────────────
  if (['staging', 'production'].includes(status)) {
    const tests = new Set(slice.files.tests || []);
    // Un composition root peut être dupliqué dans files.routes uniquement pour
    // rattacher des endpoints inline au graphe, tout en restant déclaré comme
    // config. Dans ce cas ce n'est pas un routeur autonome à couvrir par un
    // test homonyme (ex. server.js).
    const routeAliasesForGraph = new Set(slice.files.config || []);
    for (const rel of [...(slice.files.services || []), ...(slice.files.routes || [])]) {
      if (routeAliasesForGraph.has(rel)) continue;
      // Nom de base sans TOUTE extension (pas seulement le ".js" final) et
      // séparateurs "_"/"-" unifiés : évite les faux positifs sur les fichiers
      // à extension composée (ex. "catalog-enrichment.prompt.js",
      // "api-connector.base.js") et les fichiers préfixés par "_"
      // (ex. "_helpers.js" vs test "…-helpers.test.js").
      const base = testBaseKey(rel);
      const covered = [...tests].some(t => testBaseKey(t).includes(base));
      if (!covered) {
        warnings.push(`Pas de test déclaré pour ${rel} — ajouter dans files.tests ou créer le test`);
      }
    }
  }

  // ── 6. Orphelins @domain (production) ───────────────────────────────────
  if (status === 'production' && slice.domain) {
    const scanDirs = ['services', 'routes'];
    for (const dir of scanDirs) {
      const dirPath = path.join(ROOT, dir);
      if (!fs.existsSync(dirPath)) continue;
      for (const file of walk(dirPath)) {
        if (periSet.has(file)) continue;
        const domain = readHeaderDomain(file);
        if (domain && domain === slice.domain) {
          errors.push(`Fichier @domain:${slice.domain} hors slice [${status}] : ${file} — déclarer dans files.* ou changer son @domain`);
        }
      }
    }
  }

  // ── 7. Imports résiduels (deprecated) ───────────────────────────────────
  if (status === 'deprecated') {
    const allowlist = new Set(slice.deprecatedAllowlist || []);
    for (const rel of allDeclared) {
      if (!exists(rel)) continue; // déjà supprimé — OK
      const importers = findImporters(rel, periSet);
      for (const imp of importers) {
        if (!allowlist.has(imp)) {
          errors.push(`Import résiduel de ${rel} dans ${imp} — couper avant suppression`);
        }
      }
    }
    // Vérifier routes exposées → doivent être absentes du routeur principal
    if (slice.contract && Array.isArray(slice.contract.exposes)) {
      const serverSrc = exists('server.js') ? fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8') : '';
      for (const route of slice.contract.exposes) {
        const path_ = route.trim().split(/\s+/).pop();
        const base_ = path_.replace(/:.*/, '').replace(/\/$/, '');
        if (serverSrc.includes(base_) || serverSrc.includes(`'${base_}'`) || serverSrc.includes(`"${base_}"`)) {
          warnings.push(`Route encore montée sur server.js pour une feature deprecated : ${route}`);
        }
      }
    }
  }

  return { name, status, errors, warnings };
}

// ── Point d'entrée ─────────────────────────────────────────────────────────────
function main() {
  let slices = loadSlices();

  // Filtrage --feature
  if (args.feature) {
    slices = slices.filter(s => s.name === args.feature || s._file.replace('.feature.js', '') === args.feature);
    if (slices.length === 0) {
      console.error(`❌ Aucun slice trouvé pour --feature=${args.feature}`);
      process.exit(1);
    }
  }

  // Vérification d'unicité des noms
  const names = slices.map(s => s.name).filter(Boolean);
  const dupNames = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupNames.length > 0) {
    console.error(`❌ Noms de slices en doublon : ${[...new Set(dupNames)].join(', ')}`);
    process.exit(1);
  }

  // Shared migration tracker (pour détecter collisions inter-slices) —
  // clé = numéro + suffixe lettre éventuel (071, 071b), cf. migrationSlot().
  const allMigSlots = new Set();

  const results = slices.map(s => checkSlice(s, allMigSlots));

  // ── Rapport ────────────────────────────────────────────────────────────
  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    const totalErrors   = results.reduce((n, r) => n + r.errors.length,   0);
    const totalWarnings = results.reduce((n, r) => n + r.warnings.length, 0);

    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║  KOMERCE — Feature Slice Guard v1.0                     ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    for (const r of results) {
      const icon = r.errors.length > 0 ? '❌' : r.warnings.length > 0 ? '⚠️ ' : '✅';
      console.log(`${icon} [${r.status.padEnd(11)}] ${r.name}`);
      for (const e of r.errors)   console.log(`     ❌ ${e}`);
      for (const w of r.warnings) console.log(`     ⚠️  ${w}`);
    }

    console.log('');
    console.log(`Slices vérifiés : ${results.length}`);
    console.log(`Erreurs         : ${totalErrors}`);
    console.log(`Avertissements  : ${totalWarnings}`);

    if (totalErrors === 0 && totalWarnings === 0) {
      console.log('\n✅ Tous les slices sont cohérents.\n');
    } else if (totalErrors === 0) {
      console.log('\n⚠️  Avertissements présents — à traiter avant passage en production.\n');
    } else {
      console.log('\n❌ Des erreurs structurelles ont été détectées.\n');
      console.log('Doctrine : docs/doctrine/FEATURE_SLICE_DOCTRINE.md\n');
    }
  }

  // ── --save baseline ────────────────────────────────────────────────────
  if (args.save) {
    const baseline = {};
    for (const r of results) {
      baseline[r.name] = { errors: r.errors, warnings: r.warnings, savedAt: new Date().toISOString() };
    }
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2));
    console.log(`Baseline sauvegardée → ${BASELINE_FILE}`);
  }

  // ── --strict exit ──────────────────────────────────────────────────────
  if (args.strict) {
    const totalErrors = results.reduce((n, r) => n + r.errors.length, 0);
    if (totalErrors > 0) process.exit(1);
  }
}

main();
