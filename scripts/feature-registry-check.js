#!/usr/bin/env node
/**
 * feature-registry-check.js
 * Niveau 0 de la Pyramide (docs/doctrine/FEATURE_DOCTRINE.md) :
 * vérifie que toute feature déclarée dans features/*.feature.js porte les
 * propriétés métier obligatoires (service rendu, périmètre, autorité,
 * invariants), que ses fichiers déclarés existent réellement sur disque,
 * et détecte les fichiers source orphelins — non couverts par un manifest.
 *
 * Usage :
 *   node scripts/feature-registry-check.js               → rapport
 *   node scripts/feature-registry-check.js --strict      → exit(1) si erreurs (CI)
 *   node scripts/feature-registry-check.js --orphans     → liste uniquement les orphelins
 *   node scripts/feature-registry-check.js --json        → sortie JSON machine
 *
 * Même famille que code-quality-gate.js et feature-guard.js. Zéro dépendance externe.
 * Ce script vérifie l'EXISTENCE et la COMPLÉTUDE métier d'une feature (niveau 0).
 * feature-guard.js vérifie la COHÉRENCE technique du slice une fois la feature
 * reconnue (niveau 5). Les deux sont complémentaires, jamais redondants.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const FEATURES_DIR     = path.join(__dirname, '..', 'features');
// Piloting capabilities (docs/doctrine/PILOTING_CAPABILITY_DOCTRINE.md) —
// jamais des features, mais leurs fichiers doivent compter comme couverts
// pour la détection d'orphelins ci-dessous (Lot O1, 2026-07-12).
const CAPABILITIES_DIR = path.join(__dirname, '..', 'capabilities');
const ROOT          = path.join(__dirname, '..');
const STRICT        = process.argv.includes('--strict');
const ORPHANS_ONLY  = process.argv.includes('--orphans');
const JSON_OUTPUT   = process.argv.includes('--json');

// Dossiers source à auditer pour les orphelins.
// NB : 'public/' n'est PAS ajouté en bloc ici. public/boutique/ et
// public/dashboards/ sont des sous-dépôts avec leur propre outillage de
// gouvernance déjà opérationnel (scripts/boutique-ownership-full-check.js
// côté backend, public/dashboards/scripts/feature-registry-check.js côté
// dashboards) — les scanner ici en plus produirait uniquement des faux
// positifs (mêmes fichiers, groupes de déclaration différents : js/css/dash
// au lieu de services/routes/...). Voir CORRECTIONS_RATTACHEMENT_FICHIERS_
// ORPHELINS.md pour le détail de cette décision.
const SOURCE_DIRS = ['services', 'routes', 'migrations', 'middleware', 'utils', 'validators', 'core', 'bootstrap', '.github', 'db'];

// Extensions auditées par dossier — .js partout (code backend), et en plus
// les extensions pertinentes pour les dossiers non-JS ajoutés (.github, db).
const SOURCE_EXTENSIONS = {
  '.github': ['.yml', '.yaml', '.md'],
  'db':      ['.sql', '.json'],
};
const DEFAULT_EXTENSIONS = ['.js'];

// Fichiers à ignorer dans la détection d'orphelins (strict minimum — voir
// CORRECTIONS_RATTACHEMENT_FICHIERS_ORPHELINS.md pour le détail du backfill
// qui a permis de réduire cette liste au minimum requis par l'outillage git).
const ORPHAN_IGNORE = new Set([
  'package-lock.json',
]);

const REQUIRED_FIELDS = ['name', 'type', 'domain', 'status', 'owner', 'service', 'perimeter', 'authority', 'invariants'];

// ─── Lecture des manifests ─────────────────────────────────────────────────

function loadManifests() {
  if (!fs.existsSync(FEATURES_DIR)) return [];
  return fs.readdirSync(FEATURES_DIR)
    .filter(f => f.endsWith('.feature.js') && !f.startsWith('_'))
    .map(f => {
      try {
        const m = require(path.join(FEATURES_DIR, f));
        m._file = f;
        return m;
      } catch (e) {
        return { _file: f, _loadError: e.message };
      }
    });
}

// Piloting capabilities : même mécanique de chargement, mais jamais mélangées
// aux `validManifests` de features (pas de REQUIRED_FIELDS, pas de kind, pas
// de classification — voir PILOTING_CAPABILITY_DOCTRINE.md §4). Utilisées
// uniquement pour que leurs fichiers comptent comme couverts ci-dessous.
function loadCapabilities() {
  if (!fs.existsSync(CAPABILITIES_DIR)) return [];
  return fs.readdirSync(CAPABILITIES_DIR)
    .filter(f => f.endsWith('.capability.js') && !f.startsWith('_'))
    .map(f => {
      try {
        const c = require(path.join(CAPABILITIES_DIR, f));
        c._file = f;
        return c;
      } catch (e) {
        return { _file: f, _loadError: e.message };
      }
    });
}

// ─── Collecte des fichiers déclarés ───────────────────────────────────────

// Komerce est multi-dépôt (backend / bout / dash). Ce script tourne dans le contexte
// du dépôt backend : il vérifie les chemins backend déclarés (services/routes/...) et
// ignore en silence les groupes de fichiers d'autres dépôts (boutique/dash) — leur
// existence est vérifiée par leur propre outillage (ex. scripts/gen-ownership.js côté
// bout). Un manifest qui déclare repos.boutique / repos.dash documente l'intention
// cross-repo ; ce script ne la valide pas, il ne ferait que produire de faux positifs.
const BACKEND_FILE_GROUPS = new Set(['services', 'routes', 'middleware', 'utils', 'validators', 'core', 'migrations', 'tests', 'bootstrap', 'ci', 'db']);

function declaredFiles(manifests) {
  const declared = new Map(); // file → [feature name, ...] (plusieurs entrées = violation d'unicité)
  for (const m of manifests) {
    if (m._loadError) continue;
    const categories = m.files || {};
    for (const [group, files] of Object.entries(categories)) {
      if (!BACKEND_FILE_GROUPS.has(group)) continue; // boutique/dash/autres dépôts — non vérifiés ici
      if (!Array.isArray(files)) continue;
      for (const f of files) {
        if (!f || f.endsWith('/')) continue;
        if (!declared.has(f)) declared.set(f, []);
        declared.get(f).push(m.name);
      }
    }
  }
  return declared;
}

// ─── Scan des fichiers source réels ───────────────────────────────────────

function collectSourceFiles() {
  const result = [];
  for (const dir of SOURCE_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    const extensions = SOURCE_EXTENSIONS[dir] || DEFAULT_EXTENSIONS;
    scanDir(abs, dir, result, extensions);
  }
  return result;
}

function scanDir(abs, rel, result, extensions) {
  for (const entry of fs.readdirSync(abs)) {
    const absEntry = path.join(abs, entry);
    const relEntry = path.join(rel, entry);
    const stat = fs.statSync(absEntry);
    if (stat.isDirectory()) {
      scanDir(absEntry, relEntry, result, extensions);
    } else if (extensions.some(ext => entry.endsWith(ext)) && !entry.startsWith('.')) {
      result.push(relEntry);
    }
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────

function run() {
  const manifests = loadManifests();
  const errors    = [];
  const warnings  = [];
  const summary   = { features: 0, transversal: 0, declared: 0, missing: 0, multiOwner: 0, orphans: 0, load_errors: 0 };

  // 1. Erreurs de chargement manifest
  for (const m of manifests) {
    if (m._loadError) {
      errors.push({ type: 'MANIFEST-LOAD-ERROR', feature: m._file, msg: m._loadError });
      summary.load_errors++;
    }
  }

  const validManifests = manifests.filter(m => !m._loadError);
  summary.features    = validManifests.filter(m => m.type !== 'transversal').length;
  summary.transversal = validManifests.filter(m => m.type === 'transversal').length;

  // 2. Champs métier obligatoires (niveau 0 — FEATURE_DOCTRINE.md)
  for (const m of validManifests) {
    for (const field of REQUIRED_FIELDS) {
      if (m[field] === undefined || m[field] === null || m[field] === '') {
        errors.push({ type: 'MISSING-FIELD', feature: m.name || m._file, msg: `champ "${field}" manquant — obligatoire au niveau 0 (FEATURE_DOCTRINE.md)` });
      }
    }
    if (m.perimeter && (!Array.isArray(m.perimeter.in) || !Array.isArray(m.perimeter.out))) {
      errors.push({ type: 'INVALID-PERIMETER', feature: m.name, msg: 'perimeter.in et perimeter.out doivent être des tableaux, même vides — "out" ne peut pas être omis' });
    }
    if (!m.contract || !Array.isArray(m.contract.exposes) || !Array.isArray(m.contract.consumes)) {
      errors.push({ type: 'MISSING-CONTRACT', feature: m.name, msg: 'contract.exposes et contract.consumes manquants' });
    }
  }

  // 2b. Piloting capabilities (capabilities/*.capability.js) — chargées à part,
  // jamais soumises à REQUIRED_FIELDS (schéma feature), voir §4 de
  // PILOTING_CAPABILITY_DOCTRINE.md. Erreurs de chargement quand même
  // remontées : un manifest capability cassé doit être visible.
  const capabilities = loadCapabilities();
  for (const c of capabilities) {
    if (c._loadError) {
      errors.push({ type: 'MANIFEST-LOAD-ERROR', feature: c._file, msg: c._loadError });
      summary.load_errors++;
    }
  }
  const validCapabilities = capabilities.filter(c => !c._loadError);

  // 3. Fichiers déclarés manquants sur disque + unicité d'autorité (un fichier = une feature)
  const declared = declaredFiles(validManifests);
  // Fichiers couverts par une piloting capability : comptent pour l'unicité
  // d'autorité et pour la détection d'orphelins, au même titre qu'une feature
  // (Lot O1) — sans que la capability elle-même devienne un "owner" feature.
  for (const [file, owners] of declaredFiles(validCapabilities).entries()) {
    if (!declared.has(file)) declared.set(file, []);
    declared.get(file).push(...owners);
  }
  summary.declared = declared.size;

  for (const [file, owners] of declared.entries()) {
    const abs = path.join(ROOT, file);
    if (!fs.existsSync(abs)) {
      errors.push({ type: 'FILE-MISSING', feature: owners[0], file, msg: `déclaré dans ${owners[0]}.feature.js mais absent du disque` });
      summary.missing++;
    }
    if (owners.length > 1) {
      errors.push({ type: 'MULTI-OWNER', feature: owners.join(', '), file,
        msg: `déclaré par ${owners.length} manifests (${owners.join(', ')}) — unicité d'autorité violée (FEATURE_DOCTRINE.md, règle 2 du registre)` });
      summary.multiOwner = (summary.multiOwner || 0) + 1;
    }
  }

  // 4. Fichiers non déclarés — triés par gravité :
  //    DOMAIN-MISMATCH (bloquant) : @domain pointe vers une feature existante qui ne le liste pas
  //    ORPHAN (warning) : @domain unknown ou domaine sans manifest
  const featureNames = new Set(validManifests.map(m => m.name));
  const readDomain = (file) => {
    try {
      const head = fs.readFileSync(path.join(ROOT, file), 'utf8').slice(0, 2000);
      const mm = head.match(/@domain\s+(\S+)/);
      return mm ? mm[1] : null;
    } catch { return null; }
  };
  const sourceFiles = collectSourceFiles();
  for (const file of sourceFiles) {
    const normalized = file.replace(/\\/g, '/');
    if (declared.has(normalized)) continue;
    if (ORPHAN_IGNORE.has(normalized)) continue;
    if (normalized.includes('_superseded') || normalized.includes('scheduled')) continue;
    const domain = readDomain(normalized);
    if (domain && featureNames.has(domain)) {
      errors.push({ type: 'DOMAIN-MISMATCH', feature: domain, file: normalized,
        msg: '@domain ' + domain + ' mais absent du manifest ' + domain + '.feature.js — ajouter le fichier au manifest ou corriger le header' });
      summary.mismatch = (summary.mismatch || 0) + 1;
    } else {
      warnings.push({ type: 'ORPHAN', file: normalized, domain: domain || 'unknown',
        msg: 'non déclaré dans aucun manifest feature' });
      summary.orphans++;
    }
  }

  // ── Sortie ───────────────────────────────────────────────────────────────

  if (JSON_OUTPUT) {
    console.log(JSON.stringify({ summary, errors, warnings }, null, 2));
    if (STRICT && errors.length > 0) process.exit(1);
    return;
  }

  if (ORPHANS_ONLY) {
    console.log('\n🔍 Orphelins — fichiers source non déclarés dans un manifest feature\n');
    if (warnings.length === 0) {
      console.log('  ✅ Aucun orphelin détecté.');
    } else {
      for (const w of warnings) console.log(`  ⚠️  ${w.file}`);
    }
    console.log(`\n  ${warnings.length} fichier(s) non déclaré(s).`);
    return;
  }

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  Feature Registry Check — Niveau 0 — Komerce             ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  console.log(`  Features (métier)     : ${summary.features}`);
  console.log(`  Domaines transversaux : ${summary.transversal}`);
  console.log(`  Fichiers déclarés     : ${summary.declared}`);
  console.log(`  Fichiers manquants    : ${summary.missing}`);
  console.log(`  Multipropriété        : ${summary.multiOwner || 0}`);
  console.log(`  Orphelins             : ${summary.orphans}`);
  if (summary.load_errors) console.log(`  Erreurs manifest       : ${summary.load_errors}`);

  if (errors.length === 0 && warnings.length === 0) {
    console.log('\n  ✅ Registre propre — toutes les features sont complètes et déclarées.\n');
    return;
  }

  if (errors.length > 0) {
    console.log(`\n  ❌ ${errors.length} erreur(s) bloquante(s)\n`);
    for (const e of errors) {
      // FILE-MISSING et DOMAIN-MISMATCH portent feature ET file : le fichier
      // est l'info actionnable (c'est lui qu'on édite), pas le nom de feature
      // qui n'aide pas à localiser le problème. Les autres types (MISSING-FIELD,
      // INVALID-PERIMETER, MISSING-CONTRACT) n'ont que feature — on garde le fallback.
      console.log(`  [${e.type}] ${e.file || e.feature}`);
      if (e.file && e.feature) console.log(`    feature: ${e.feature}`);
      console.log(`    → ${e.msg}\n`);
    }
  }

  if (warnings.length > 0) {
    console.log(`  ⚠️  ${warnings.length} orphelin(s) non déclaré(s) (avertissement — voir dette connue du registre)\n`);
    for (const w of warnings) {
      console.log(`  [ORPHAN] ${w.file}`);
    }
    console.log('');
  }

  if (STRICT && errors.length > 0) {
    console.log('  ──  Mode --strict : exit(1)\n');
    process.exit(1);
  }
}

run();
