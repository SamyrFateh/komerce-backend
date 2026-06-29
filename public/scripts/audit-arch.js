#!/usr/bin/env node
/**
 * ============================================================
 * KOMERCE DASHBOARDS — Architecture Audit (Niveau 4 — Pyramide Qualité)
 * Version 1.0.0 · 2026-06
 * 0 dépendances externes — Node.js >= 18
 * Doctrine : docs/doctrine/QUALITY_PYRAMID_DOCTRINE.md
 * ============================================================
 *
 * Vérifie que chaque fichier JS actif (hors deprecated) porte un bloc
 * @komerce-arch valide avec les champs requis, et que @domain est cohérent
 * avec le manifest feature déclarant ce fichier.
 *
 * Checks :
 *   A1 — Bloc @komerce-arch présent
 *   A2 — Champs requis : @role, @domain, @layer, @criticality
 *   A3 — @domain cohérent avec le manifest feature (cross-check N0)
 *   A4 — @layer appartient aux valeurs autorisées
 *   A5 — Ownership : tout fichier scanné est déclaré dans un manifest
 *
 * Usage :
 *   node scripts/audit-arch.js              ← rapport complet
 *   node scripts/audit-arch.js --strict     ← exit(1) si violation (CI)
 *   node scripts/audit-arch.js --json       ← sortie JSON
 *   node scripts/audit-arch.js --domain admin-dashboard ← filtre un domaine
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ── Configuration ─────────────────────────────────────────────────────────────

const SCAN_DIRS = [
  'dashboards/admin/js',
  'js',
];
const ROOT_FILES = ['sw.js'];

const IGNORE_PATTERNS = [
  /node_modules/,
  /\.min\.js$/,
  /admin-legacy/,  // status: deprecated — exclue
];

// @komerce-arch complet exige @criticality ; @komerce-arch-lite est le variant léger (sans criticality)
const REQUIRED_FIELDS_FULL = ['@role', '@domain', '@layer', '@criticality'];
const REQUIRED_FIELDS_LITE = ['@role', '@domain', '@layer'];

const ALLOWED_LAYERS = new Set([
  'entrypoint', 'ui-page', 'ui-component', 'ui-renderer',
  'api-client', 'state-store', 'auth', 'service-worker',
  'utility', 'platform', 'view-model', 'infrastructure',
]);

// ── CLI ───────────────────────────────────────────────────────────────────────

const args = (() => {
  const a = { strict: false, json: false, domain: null };
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--strict')          a.strict = true;
    else if (arg === '--json')       a.json   = true;
    else if (arg === '--domain')     a.domain = process.argv[++i];
  }
  return a;
})();

// ── Collecte des fichiers JS ──────────────────────────────────────────────────

function collectFiles() {
  const files = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel  = path.relative(ROOT, full);
      if (IGNORE_PATTERNS.some(p => p.test(rel))) continue;
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.js')) {
        files.push(rel);
      }
    }
  }

  SCAN_DIRS.forEach(d => walk(path.join(ROOT, d)));
  ROOT_FILES.forEach(f => {
    const full = path.join(ROOT, f);
    if (fs.existsSync(full)) files.push(f);
  });

  return files;
}

// ── Chargement des manifests N0 ───────────────────────────────────────────────

function loadManifests() {
  // Map : relpath -> { feature, domain }
  const fileToFeature = new Map();
  // Map : feature name -> domain
  const featureDomains = new Map();

  const featuresDir = path.join(ROOT, 'features');
  if (!fs.existsSync(featuresDir)) return { fileToFeature, featureDomains };

  for (const fname of fs.readdirSync(featuresDir)) {
    if (!fname.endsWith('.feature.js')) continue;
    try {
      const manifest = require(path.join(featuresDir, fname));
      featureDomains.set(manifest.name, manifest.domain);

      const files = manifest.files || {};
      for (const category of Object.keys(files)) {
        if (category === 'tests') continue;
        for (const f of (files[category] || [])) {
          // Les chemins dans les manifests sont relatifs à features/, ex: '../dashboards/admin/js/...'
          const resolved = path.relative(ROOT, path.resolve(featuresDir, f));
          fileToFeature.set(resolved, { feature: manifest.name, domain: manifest.domain });
        }
      }
    } catch (_) {}
  }

  return { fileToFeature, featureDomains };
}

// ── Extraction du bloc @komerce-arch ─────────────────────────────────────────

function parseArchHeader(src) {
  const isLite = src.includes('@komerce-arch-lite');
  if (!src.includes('@komerce-arch')) return null;

  const fields = { _isLite: isLite };
  const fieldRe = /^\s*\*\s*@(\S+)[ \t]+(.+)$/gm;
  let m;
  while ((m = fieldRe.exec(src)) !== null) {
    const key = m[1];
    const val = m[2].trim();
    if (['komerce-arch'].includes(key)) continue;
    if (!fields[key]) fields[key] = val;
  }
  return fields;
}

// ── Vérifications par fichier ─────────────────────────────────────────────────

function auditFile(relPath, fileToFeature) {
  const violations = [];
  const warnings   = [];

  let src;
  try {
    src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  } catch (e) {
    violations.push({ code: 'READ_ERROR', msg: e.message });
    return { relPath, violations, warnings, domain: null };
  }

  // A1 — Bloc présent
  if (!src.includes('@komerce-arch')) {
    violations.push({ code: 'A1', msg: 'Bloc @komerce-arch absent' });
    return { relPath, violations, warnings, domain: null };
  }

  const fields = parseArchHeader(src);
  if (!fields) {
    violations.push({ code: 'A1', msg: 'Bloc @komerce-arch non parseable' });
    return { relPath, violations, warnings, domain: null };
  }

  // A2 — Champs requis
  const required = fields['_isLite'] ? REQUIRED_FIELDS_LITE : REQUIRED_FIELDS_FULL;
  for (const req of required) {
    const k = req.replace('@', '');
    if (!fields[k] || fields[k] === 'none' || fields[k] === '') {
      violations.push({ code: 'A2', msg: `Champ requis manquant ou vide : ${req}` });
    }
  }

  const domain = fields['domain'] || null;

  // A4 — @layer valide
  if (fields['layer'] && !ALLOWED_LAYERS.has(fields['layer'])) {
    warnings.push({ code: 'A4', msg: `@layer inconnu : "${fields['layer']}" (valeurs autorisées : ${[...ALLOWED_LAYERS].join(', ')})` });
  }

  // A3 — @domain cohérent avec le manifest
  const manifestEntry = fileToFeature.get(relPath);
  if (!manifestEntry) {
    warnings.push({ code: 'A5', msg: 'Fichier non déclaré dans aucun manifest feature (orphelin N0)' });
  } else if (domain && domain !== manifestEntry.domain) {
    violations.push({
      code: 'A3',
      msg: `@domain "${domain}" ≠ domaine manifest "${manifestEntry.domain}" (feature: ${manifestEntry.feature})`,
    });
  }

  return { relPath, violations, warnings, domain };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const { fileToFeature, featureDomains } = loadManifests();
  const files = collectFiles();

  const results  = [];
  let totalViol  = 0;
  let totalWarn  = 0;

  for (const f of files) {
    if (args.domain) {
      // Filtrer : on regarde le @domain dans le header
      const src = fs.existsSync(path.join(ROOT, f)) ? fs.readFileSync(path.join(ROOT, f), 'utf8') : '';
      if (!src.includes(`@domain        ${args.domain}`) && !src.includes(`@domain ${args.domain}`)) continue;
    }

    const res = auditFile(f, fileToFeature);
    results.push(res);
    totalViol += res.violations.length;
    totalWarn += res.warnings.length;
  }

  const clean   = results.filter(r => r.violations.length === 0 && r.warnings.length === 0);
  const withVio = results.filter(r => r.violations.length > 0);
  const withWrn = results.filter(r => r.violations.length === 0 && r.warnings.length > 0);

  if (args.json) {
    console.log(JSON.stringify({ results, totalViol, totalWarn, scanned: files.length }, null, 2));
    process.exit(args.strict && totalViol > 0 ? 1 : 0);
  }

  // ── Rapport lisible ─────────────────────────────────────────────────────────
  const W = '\x1b[33m⚠\x1b[0m';
  const E = '\x1b[31m✗\x1b[0m';
  const OK= '\x1b[32m✓\x1b[0m';

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  KOMERCE DASHBOARDS — Audit Architecture (N4)            ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`  Fichiers scannés : ${results.length}  (${files.length} total, ${files.length - results.length} filtrés)`);
  console.log(`  ${OK} Conformes       : ${clean.length}`);
  console.log(`  ${W} Avertissements  : ${withWrn.length} fichiers, ${totalWarn} warnings`);
  console.log(`  ${E} Violations      : ${withVio.length} fichiers, ${totalViol} violations\n`);

  if (withVio.length > 0) {
    console.log('── VIOLATIONS ───────────────────────────────────────────────\n');
    for (const r of withVio) {
      console.log(`  ${E} ${r.relPath}`);
      for (const v of r.violations) {
        console.log(`       [${v.code}] ${v.msg}`);
      }
    }
    console.log();
  }

  if (withWrn.length > 0 && !args.strict) {
    console.log('── AVERTISSEMENTS ───────────────────────────────────────────\n');
    for (const r of withWrn) {
      console.log(`  ${W} ${r.relPath}`);
      for (const w of r.warnings) {
        console.log(`       [${w.code}] ${w.msg}`);
      }
    }
    console.log();
  }

  // Résumé domaines
  const domainCount = {};
  for (const r of results) {
    if (r.domain) domainCount[r.domain] = (domainCount[r.domain] || 0) + 1;
  }
  if (Object.keys(domainCount).length > 0) {
    console.log('── RÉPARTITION PAR DOMAINE ──────────────────────────────────\n');
    for (const [d, n] of Object.entries(domainCount).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${d.padEnd(30)} ${n} fichier(s)`);
    }
    console.log();
  }

  if (totalViol === 0) {
    console.log(`  ${OK} Audit N4 — CONFORME (0 violation)\n`);
  } else {
    console.log(`  ${E} Audit N4 — ${totalViol} violation(s) bloquante(s)\n`);
  }

  if (args.strict && totalViol > 0) process.exit(1);
}

main();
