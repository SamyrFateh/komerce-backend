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

const FEATURES_DIR = path.join(__dirname, '..', 'features');
const ROOT          = path.join(__dirname, '..');
const STRICT        = process.argv.includes('--strict');
const ORPHANS_ONLY  = process.argv.includes('--orphans');
const JSON_OUTPUT   = process.argv.includes('--json');

// Dossiers source à auditer pour les orphelins.
// Scope volontairement limité à js/ : le CSS a déjà son propre outillage
// dédié (gen-ownership.js, css-guard.js, check-css-dist-only.js) qui suit
// une logique différente (multipropriété de sélecteur, pas rattachement
// fichier↔feature) — pas la peine de dupliquer ici.
// 2026-07-06 (audit gouvernance) : ce script scannait 'admin' + 'admin-legacy/js'
// relatifs à public/, qui pointait sur public/admin (arbre mort, supprimé §4).
// public/features/ ne déclare plus que 'platform' (admin-dashboard et
// legacy-control-tower manifests supprimés — doublons de dashboards/features/) :
// le périmètre réel de ce registre est désormais public/js uniquement.
// L'audit de dashboards/admin est déjà couvert par
// public/dashboards/scripts/feature-registry-check.js (FEATURES_DIR propre).
const SOURCE_DIRS = ['js'];

// Fichiers/dossiers à ignorer dans la détection d'orphelins
const ORPHAN_IGNORE_DIRS = ['node_modules','features','scripts','images','icons','uploads','css','hub','relais']; // build artifact (vite/esbuild), pas du code source
const ORPHAN_IGNORE = new Set([
  'chart.umd.min.js',
  // (rien pour l'instant côté boutique — tout fichier js/* doit être rattaché)
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

// ─── Collecte des fichiers déclarés ───────────────────────────────────────

// Komerce est multi-dépôt (backend / boutique / dash). Ce script tourne dans
// le contexte du dépôt boutique : il ne vérifie que le groupe 'js' (le CSS a
// son propre outillage, voir plus haut) et ignore en silence tout autre
// groupe (ex. 'dist', utilisé par modal-product.feature.js pour ses
// contrats render-static — pas un manifest fichier↔feature).
const DASHBOARD_FILE_GROUPS = new Set(['js']);

function declaredFiles(manifests) {
  const declared = new Map(); // file (ROOT-relatif, normalisé) → feature name
  for (const m of manifests) {
    if (m._loadError) continue;
    const categories = m.files || {};
    for (const [group, files] of Object.entries(categories)) {
      if (!DASHBOARD_FILE_GROUPS.has(group)) continue; // ex. 'dist' (contrats render-static) — non vérifié ici
      if (!Array.isArray(files)) continue;
      for (const f of files) {
        if (!f || f.endsWith('/')) continue;
        // Les chemins de manifest sont relatifs à features/ (ex. '../js/foo.js').
        const abs = path.resolve(FEATURES_DIR, f);
        const rootRelative = path.relative(ROOT, abs).replace(/\\/g, '/');
        declared.set(rootRelative, m.name);
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
    scanDir(abs, dir, result);
  }
  return result;
}

function scanDir(abs, rel, result) {
  for (const entry of fs.readdirSync(abs)) {
    const absEntry = path.join(abs, entry);
    const relEntry = path.join(rel, entry);
    if (ORPHAN_IGNORE_DIRS.includes(relEntry.replace(/\\/g, '/'))) continue;
    const stat = fs.statSync(absEntry);
    if (stat.isDirectory()) {
      scanDir(absEntry, relEntry, result);
    } else if (entry.endsWith('.js') && !entry.startsWith('.')) {
      result.push(relEntry);
    }
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────

function run() {
  const manifests = loadManifests();
  const errors    = [];
  const warnings  = [];
  const summary   = { features: 0, transversal: 0, declared: 0, missing: 0, orphans: 0, load_errors: 0 };

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

  // 3. Fichiers déclarés manquants sur disque
  const declared = declaredFiles(validManifests);
  summary.declared = declared.size;

  for (const [file, feature] of declared.entries()) {
    const abs = path.join(ROOT, file);
    if (!fs.existsSync(abs)) {
      errors.push({ type: 'FILE-MISSING', feature, file, msg: `déclaré dans ${feature}.feature.js mais absent du disque` });
      summary.missing++;
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
  console.log('║  Feature Registry Check — Niveau 0 — Komerce (dashboards)  ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  console.log(`  Features (métier)     : ${summary.features}`);
  console.log(`  Domaines transversaux : ${summary.transversal}`);
  console.log(`  Fichiers déclarés     : ${summary.declared}`);
  console.log(`  Fichiers manquants    : ${summary.missing}`);
  console.log(`  Orphelins             : ${summary.orphans}`);
  if (summary.load_errors) console.log(`  Erreurs manifest       : ${summary.load_errors}`);

  if (errors.length === 0 && warnings.length === 0) {
    console.log('\n  ✅ Registre propre — toutes les features sont complètes et déclarées.\n');
    return;
  }

  if (errors.length > 0) {
    console.log(`\n  ❌ ${errors.length} erreur(s) bloquante(s)\n`);
    for (const e of errors) {
      console.log(`  [${e.type}] ${e.feature || e.file}`);
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
