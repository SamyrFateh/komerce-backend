#!/usr/bin/env node
/**
 * ============================================================
 * KOMERCE BOUTIQUE — Feature Slice Guard (Niveau 5)
 * Version 1.0.0 · 2026-06
 * 0 dependances externes — Node.js >= 18
 * Doctrine : docs/doctrine/FEATURE_SLICE_DOCTRINE.md
 * ============================================================
 *
 * Verifie la COHERENCE technique de chaque slice feature :
 *   - champs obligatoires presents
 *   - fichiers declares existent sur disque
 *   - @domain du header correspond au manifest qui le declare
 *   - contrats positifs render-static (mustContain) respectes
 *   - couverture test declaree (si files.tests present)
 *
 * Usage :
 *   node scripts/feature-guard.js                      # rapport
 *   node scripts/feature-guard.js --strict             # exit(1) si ecart
 *   node scripts/feature-guard.js --feature catalog    # un seul slice
 *   node scripts/feature-guard.js --json               # JSON
 *   node scripts/feature-guard.js --contracts-only     # contrats positifs seuls
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT          = path.resolve(__dirname, '..');
const FEATURES_DIR  = path.join(ROOT, 'features');
const STRICT        = process.argv.includes('--strict');
const JSON_OUTPUT   = process.argv.includes('--json');
const CONTRACTS_ONLY = process.argv.includes('--contracts-only');

const featureArg = (() => {
  const i = process.argv.indexOf('--feature');
  return i >= 0 ? process.argv[i + 1] : null;
})();

// ── Lecture des manifests ──────────────────────────────────────────────────

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

// ── Helpers ────────────────────────────────────────────────────────────────

function readDomain(absPath) {
  try {
    const head = fs.readFileSync(absPath, 'utf8').slice(0, 2000);
    const m = head.match(/@domain\s+(\S+)/);
    return m ? m[1] : null;
  } catch { return null; }
}

function resolveFile(relPath) {
  return path.resolve(FEATURES_DIR, relPath);
}

// ── Verification d'un slice ───────────────────────────────────────────────

function checkSlice(slice) {
  const errors   = [];
  const warnings = [];
  const name     = slice.name || slice._file;
  const status   = slice.status || 'draft';

  if (slice._loadError) {
    errors.push('Erreur de chargement : ' + slice._loadError);
    return { name, status, errors, warnings };
  }

  // ── 1. Champs obligatoires ──────────────────────────────────────────────
  for (const field of ['name', 'domain', 'status', 'owner', 'files']) {
    if (!slice[field]) errors.push(`Champ obligatoire manquant : "${field}"`);
  }
  if (!['draft', 'staging', 'production', 'deprecated'].includes(status)) {
    errors.push(`Status invalide : "${status}"`);
  }

  if (!slice.files) return { name, status, errors, warnings };

  // ── 2. Fichiers declares existent ───────────────────────────────────────
  const allDeclaredAbs = [];
  for (const [group, files] of Object.entries(slice.files)) {
    if (!Array.isArray(files)) { warnings.push(`files.${group} n'est pas un tableau`); continue; }
    for (const rel of files) {
      if (!rel || rel.endsWith('/')) continue;
      const abs = resolveFile(rel);
      allDeclaredAbs.push({ abs, rel, group });
      if (!fs.existsSync(abs)) {
        errors.push(`Fichier absent [${group}] : ${rel}`);
      }
    }
  }

  // ── 3. @domain header coherence ─────────────────────────────────────────
  // Chaque fichier JS declare dans files.js doit avoir @domain === slice.domain
  const jsFiles = allDeclaredAbs.filter(f => f.group === 'js' && f.abs.endsWith('.js'));
  for (const { abs, rel } of jsFiles) {
    if (!fs.existsSync(abs)) continue;
    const fileDomain = readDomain(abs);
    if (!fileDomain) {
      warnings.push(`Header @domain absent : ${rel}`);
    } else if (fileDomain !== slice.domain) {
      errors.push(`@domain mismatch : ${rel} declare @domain "${fileDomain}" mais est liste dans ${name}.feature.js (domain "${slice.domain}")`);
    }
  }

  // ── 4. Contrats positifs render-static ──────────────────────────────────
  if (slice.contracts && Array.isArray(slice.contracts['render-static'])) {
    for (const contract of slice.contracts['render-static']) {
      const artifactAbs = resolveFile(contract.artifact);
      if (!fs.existsSync(artifactAbs)) {
        errors.push(`[CONTRACT] Artifact absent : ${contract.artifact} (${contract.label})`);
        continue;
      }
      const content = fs.readFileSync(artifactAbs, 'utf8');
      if (Array.isArray(contract.mustContain)) {
        for (const pattern of contract.mustContain) {
          const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
          if (!re.test(content)) {
            errors.push(`[CONTRACT FAIL] ${contract.label} — pattern non trouve dans ${contract.artifact} : ${re.source.slice(0, 80)}`);
          }
        }
      }
    }
  }

  // ── 5. Doctrine token budget ────────────────────────────────────────────
  // Si contracts.doctrine = {scope, max} existe, compter reellement les
  // rgba(...) non-tokenises dans slice.files[scope] et bloquer tout depassement.
  // (Avant : simple warning texte renvoyant vers css-guard, qui ne verifie
  // pas ca — le budget declare n'etait donc jamais controle.)
  let doctrineReport = null;
  if (slice.contracts && slice.contracts.doctrine && typeof slice.contracts.doctrine === 'object'
      && slice.contracts.doctrine.max !== undefined) {
    const { scope, max } = slice.contracts.doctrine;
    const scopeFiles = (slice.files && slice.files[scope]) || [];
    if (scopeFiles.length === 0) {
      warnings.push(`Doctrine token budget declare (max: ${max}) mais scope "${scope}" ne correspond a aucun groupe de files.* — impossible a verifier`);
    } else {
      let count = 0;
      const perFile = {};
      for (const rel of scopeFiles) {
        const abs = resolveFile(rel);
        if (!fs.existsSync(abs)) continue; // deja signale en section 2 (fichier declare absent)
        const raw = fs.readFileSync(abs, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); // hors commentaires
        const n = (raw.match(/rgba\(/g) || []).length;
        if (n > 0) perFile[rel] = n;
        count += n;
      }
      doctrineReport = { scope, max, count, perFile };
      if (count > max) {
        errors.push(`[DOCTRINE] Budget rgba depasse (scope "${scope}") : ${count}/${max} — ` +
          Object.entries(perFile).map(([f, n]) => `${f}:${n}`).join(', '));
      }
    }
  }

  // ── 6. Deprecated slice checks ──────────────────────────────────────────
  if (status === 'deprecated') {
    for (const { abs, rel } of allDeclaredAbs) {
      if (!fs.existsSync(abs)) continue;
      const head = fs.readFileSync(abs, 'utf8').slice(0, 2000);
      if (!head.includes('@status') || !head.includes('deprecated')) {
        warnings.push(`Fichier deprecated sans @status deprecated dans header : ${rel}`);
      }
    }
  }

  return { name, status, errors, warnings, doctrineReport };
}

function describeDoctrine(count, max) {
  if (count > max) return { icon: '❌', note: ' — DEPASSE' };
  if (max === 0)    return { icon: '✅', note: count === 0 ? ' — entierement tokenise' : '' };
  if (count === max) return { icon: '⚠️ ', note: ' — au plafond, plus de marge' };
  return { icon: '✅', note: '' };
}

function main() {
  let manifests = loadManifests();
  if (featureArg) {
    manifests = manifests.filter(m => m.name === featureArg || m._file === featureArg + '.feature.js');
    if (manifests.length === 0) {
      console.error(`Feature "${featureArg}" non trouvee dans ${FEATURES_DIR}`);
      process.exit(1);
    }
  }

  const results    = manifests.map(m => checkSlice(m));
  const totalErr   = results.reduce((n, r) => n + r.errors.length, 0);
  const totalWarn  = results.reduce((n, r) => n + r.warnings.length, 0);

  if (JSON_OUTPUT) {
    console.log(JSON.stringify({ slices: results.length, errors: totalErr, warnings: totalWarn, results }, null, 2));
    if (STRICT && totalErr > 0) process.exit(1);
    return;
  }

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  Feature Slice Guard — Niveau 5 — Komerce (boutique)    ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  console.log(`  Slices verifies   : ${results.length}`);
  console.log(`  Erreurs           : ${totalErr}`);
  console.log(`  Avertissements    : ${totalWarn}`);

  const doctrineResults = results.filter(r => r.doctrineReport);

  if (totalErr === 0 && totalWarn === 0) {
    console.log('\n  ✅ Tous les slices sont coherents.\n');
    if (doctrineResults.length) {
      console.log('Budgets doctrine token (rgba non-tokenises) :');
      for (const r of doctrineResults) {
        const { scope, max, count } = r.doctrineReport;
        const { icon, note } = describeDoctrine(count, max);
        console.log(`  ${icon} ${r.name} (scope "${scope}") : ${count}/${max}${note}`);
      }
      console.log('');
    }
    if (STRICT) process.exit(0);
    return;
  }

  console.log('');

  for (const r of results) {
    if (r.errors.length === 0 && r.warnings.length === 0) continue;
    const icon = r.errors.length > 0 ? '❌' : '⚠️ ';
    console.log(`${icon} [${r.status.padEnd(10)}] ${r.name}`);
    for (const e of r.errors)   console.log(`     ❌ ${e}`);
    for (const w of r.warnings) console.log(`     ⚠️  ${w}`);
    console.log('');
  }

  console.log(`Doctrine : docs/doctrine/FEATURE_SLICE_DOCTRINE.md\n`);

  if (doctrineResults.length) {
    console.log('Budgets doctrine token (rgba non-tokenises) :');
    for (const r of doctrineResults) {
      const { scope, max, count } = r.doctrineReport;
      const { icon, note } = describeDoctrine(count, max);
      console.log(`  ${icon} ${r.name} (scope "${scope}") : ${count}/${max}${note}`);
    }
    console.log('');
  }

  if (STRICT && totalErr > 0) {
    console.log('  ──  Mode --strict : exit(1)\n');
    process.exit(1);
  }
}

main();
