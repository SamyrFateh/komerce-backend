#!/usr/bin/env node
/**
 * ============================================================
 * KOMERCE DASHBOARDS — Feature Slice Guard (Niveau 5 — Pyramide Qualité)
 * Version 1.0.0 · 2026-06
 * 0 dépendances externes — Node.js >= 18
 * Doctrine : docs/doctrine/FEATURE_DOCTRINE.md (§ Ordre de gouvernance complet)
 * ============================================================
 *
 * Complémentaire de feature-registry-check.js (N0) et audit-arch.js (N4) :
 *   - N0 vérifie que la feature EXISTE et que ses fichiers JS déclarés
 *     existent (scope limité au groupe 'js', cf. DASHBOARD_FILE_GROUPS).
 *   - N4 vérifie que chaque fichier JS actif porte un header @komerce-arch
 *     cohérent avec son manifest.
 *   - N5 (ce script) vérifie la COHÉRENCE DU SLICE dans son ensemble une
 *     fois la feature reconnue : toutes les catégories de `files` (pas
 *     seulement 'js'), le graphe contract.exposes/consumes, et la non-
 *     vacuité du périmètre. C'est la porte de merge finale.
 *
 * Checks :
 *   G1 — Toutes les catégories de `files.*` (toutes, sans filtre de groupe)
 *        pointent vers des fichiers qui existent réellement sur disque.
 *   G2 — Intégrité référentielle du contrat : chaque domaine listé dans
 *        `contract.consumes` d'une feature doit être (a) le nom d'une
 *        feature existante et (b) listé dans le `contract.exposes` de
 *        cette feature.
 *   G3 — `perimeter.in` et `perimeter.out` sont des tableaux NON VIDES
 *        (N0 vérifie déjà le typage, pas la non-vacuité — un slice sans
 *        territoire déclaré n'est pas mergeable).
 *   G4 — Cycle de vie : une feature `status: deprecated` ne peut pas
 *        apparaître dans `contract.consumes` d'une feature `production`
 *        (dépendance active non documentée sur du code en sursis).
 *
 * Usage :
 *   node scripts/feature-guard.js              ← rapport complet
 *   node scripts/feature-guard.js --strict     ← exit(1) si violation (CI)
 *   node scripts/feature-guard.js --json       ← sortie JSON
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT         = path.resolve(__dirname, '..');
const FEATURES_DIR = path.join(ROOT, 'features');

const args = (() => {
  const a = { strict: false, json: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--strict') a.strict = true;
    else if (arg === '--json') a.json = true;
  }
  return a;
})();

// ── Chargement des manifests ──────────────────────────────────────────────────

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

// ── G1 — Toutes les catégories de fichiers existent ─────────────────────────

function checkFilesExist(manifests, errors) {
  for (const m of manifests) {
    const categories = m.files || {};
    for (const [group, files] of Object.entries(categories)) {
      if (!Array.isArray(files)) continue;
      for (const f of files) {
        if (!f || f.endsWith('/')) continue;
        const abs = path.resolve(FEATURES_DIR, f);
        if (!fs.existsSync(abs)) {
          errors.push({
            code: 'G1', feature: m.name,
            msg: `files.${group} déclare "${f}" — absent du disque`,
          });
        }
      }
    }
  }
}

// ── G2 — Intégrité référentielle exposes/consumes ────────────────────────────

function checkContractIntegrity(manifests, errors) {
  const exposesByFeature = new Map(); // feature name -> Set(domains exposés)
  for (const m of manifests) {
    const exposes = (m.contract && Array.isArray(m.contract.exposes)) ? m.contract.exposes : [];
    exposesByFeature.set(m.name, new Set(exposes));
  }
  const featureNames = new Set(manifests.map(m => m.name));

  for (const m of manifests) {
    const consumes = (m.contract && Array.isArray(m.contract.consumes)) ? m.contract.consumes : [];
    for (const dep of consumes) {
      // Convention : un consumes peut s'écrire "feature" ou "feature:domain".
      const [depFeature, depDomain] = dep.includes(':') ? dep.split(':') : [dep, null];

      if (!featureNames.has(depFeature)) {
        errors.push({
          code: 'G2', feature: m.name,
          msg: `contract.consumes référence "${dep}" — aucune feature "${depFeature}" dans le registre`,
        });
        continue;
      }
      if (depDomain) {
        const exposed = exposesByFeature.get(depFeature);
        if (!exposed.has(depDomain)) {
          errors.push({
            code: 'G2', feature: m.name,
            msg: `contract.consumes référence "${dep}" — "${depDomain}" absent de contract.exposes de "${depFeature}"`,
          });
        }
      }
    }
  }
}

// ── G3 — Périmètre non vide ──────────────────────────────────────────────────

function checkPerimeterNonEmpty(manifests, errors) {
  for (const m of manifests) {
    if (!m.perimeter) continue; // déjà signalé par feature-registry-check.js (N0)
    if (Array.isArray(m.perimeter.in) && m.perimeter.in.length === 0) {
      errors.push({ code: 'G3', feature: m.name, msg: 'perimeter.in est vide — slice sans territoire déclaré' });
    }
    if (Array.isArray(m.perimeter.out) && m.perimeter.out.length === 0) {
      errors.push({ code: 'G3', feature: m.name, msg: 'perimeter.out est vide — aucune frontière documentée' });
    }
  }
}

// ── G4 — Cycle de vie : pas de dépendance active sur du code déprécié ───────

function checkLifecycle(manifests, errors) {
  const statusByFeature = new Map(manifests.map(m => [m.name, m.status]));
  for (const m of manifests) {
    if (m.status !== 'production') continue;
    const consumes = (m.contract && Array.isArray(m.contract.consumes)) ? m.contract.consumes : [];
    for (const dep of consumes) {
      const depFeature = dep.includes(':') ? dep.split(':')[0] : dep;
      if (statusByFeature.get(depFeature) === 'deprecated') {
        errors.push({
          code: 'G4', feature: m.name,
          msg: `dépend de "${depFeature}" (status: deprecated) via contract.consumes sans dépréciation documentée`,
        });
      }
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const manifests = loadManifests();
  const loadErrors = manifests.filter(m => m._loadError);
  const valid = manifests.filter(m => !m._loadError);

  const errors = [];
  for (const e of loadErrors) {
    errors.push({ code: 'G0', feature: e._file, msg: `manifest non chargeable : ${e._loadError}` });
  }

  checkFilesExist(valid, errors);
  checkContractIntegrity(valid, errors);
  checkPerimeterNonEmpty(valid, errors);
  checkLifecycle(valid, errors);

  // Note informative (pas une violation) : aucun manifest ne déclare encore
  // `files.tests` — la couverture N3 existante (8 smoke tests, D4) est
  // générique (tests/views/critical-views.smoke.test.js) et non rattachée
  // feature par feature. Dette connue, déjà documentée (cf. GOVERNANCE_STATUS).
  const featuresWithTests = valid.filter(m => m.files && Array.isArray(m.files.tests) && m.files.tests.length > 0);

  if (args.json) {
    console.log(JSON.stringify({ errors, featuresWithDeclaredTests: featuresWithTests.length, totalFeatures: valid.length }, null, 2));
    if (args.strict && errors.length > 0) process.exit(1);
    return;
  }

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  KOMERCE DASHBOARDS — Feature Slice Guard (N5)           ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  console.log(`  Features auditées        : ${valid.length}`);
  console.log(`  Manifests non chargeables : ${loadErrors.length}`);
  console.log(`  Violations                : ${errors.length}`);
  console.log(`  Features avec files.tests : ${featuresWithTests.length}/${valid.length} (info — non bloquant, voir N3)\n`);

  if (errors.length === 0) {
    console.log('  ✅ Slice guard N5 — CONFORME (0 violation). Tous les slices sont cohérents.\n');
  } else {
    console.log('── VIOLATIONS ───────────────────────────────────────────────\n');
    for (const e of errors) {
      console.log(`  ❌ [${e.code}] ${e.feature}`);
      console.log(`     → ${e.msg}`);
    }
    console.log(`\n  ❌ Slice guard N5 — ${errors.length} violation(s) bloquante(s).\n`);
  }

  if (args.strict && errors.length > 0) process.exit(1);
}

main();
