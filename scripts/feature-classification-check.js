#!/usr/bin/env node
/**
 * feature-classification-check.js
 *
 * Vérifie le champ `classification` des manifests features/*.feature.js.
 * Complément de feature-registry-check.js (niveau 0) et feature-guard.js (niveau 5).
 *
 * Philosophie ratchet :
 *   Phase 4 (active depuis 2026-08-16) : backfill global fermé.
 *   Le mode normal reste un rapport ; --strict bloque erreurs ET warnings.
 *   Toute nouvelle dette de classification redevient donc un signal attribuable au changement courant.
 *
 * Usage :
 *   node scripts/feature-classification-check.js              → rapport complet
 *   node scripts/feature-classification-check.js --strict     → exit(1) si violations bloquantes
 *   node scripts/feature-classification-check.js --json       → sortie JSON machine
 *   node scripts/feature-classification-check.js --feature shared-cart  → un seul manifest
 *
 * Règles bloquantes (--strict uniquement) :
 *   - kind non autorisé (y compris 'projection' — jamais assignable)
 *   - aggregation-readonly avec @db-write autre que '(none)'
 *   - technical-transversal avec migrations métier déclarées
 *   - externalSideEffect hors whitelist
 *   - perimeter.out absent ou vide sur feature production
 *
 * Warnings seulement (toujours) :
 *   - manifest sans classification
 *   - rationale absent ou < 2 entrées
 *   - multiConsumer:true sans contract.consumes renseigné
 *   - ownsMigrations:true mais files.migrations absent ou vide
 *   - externalSideEffect !== 'none' sans invariant lié
 *
 * Zéro dépendance externe. Même famille que feature-registry-check.js.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT         = path.join(__dirname, '..');
const FEATURES_DIR = path.join(ROOT, 'features');

const STRICT      = process.argv.includes('--strict');
const JSON_OUTPUT = process.argv.includes('--json');
const FEATURE_ARG = (() => {
  const i = process.argv.indexOf('--feature');
  return i >= 0 ? process.argv[i + 1] : null;
})();

// ─── Listes de référence ───────────────────────────────────────────────────

const ALLOWED_KINDS = new Set([
  'business-feature',
  'business-transversal',
  'technical-transversal',
  'technical-foundation',
  'aggregation-readonly',
  'integration-adapter',
  'deprecated',
  // NOTE : 'projection' n'est PAS dans cette liste — c'est un verdict de rattachement,
  // jamais un kind assignable à un manifest (FEATURE_DOCTRINE.md §Schéma de classification).
]);

const ALLOWED_EXTERNAL_SIDE_EFFECTS = new Set([
  'none',
  'outbound-message',
  'payment',
  'refund',
  'document',
  'webhook',
  'auth-token',
  'file-generation',
]);

const ALLOWED_DECISIONS = new Set([
  'feature-autonome',
  'feature-transverse',
  'transversal-technique',
  'aggregation-lecture',
  'adapter-externe',
  'deprecated',
]);

// ─── Chargement des manifests ──────────────────────────────────────────────

function loadManifests() {
  if (!fs.existsSync(FEATURES_DIR)) return [];
  return fs.readdirSync(FEATURES_DIR)
    .filter(f => f.endsWith('.feature.js') && !f.startsWith('_'))
    .filter(f => !FEATURE_ARG || f === `${FEATURE_ARG}.feature.js`)
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

// ─── Lecture du @db-write dans un fichier source ───────────────────────────

function readDbWrite(relPath) {
  try {
    const abs  = path.join(ROOT, relPath);
    if (!fs.existsSync(abs)) return null;
    const head = fs.readFileSync(abs, 'utf8').slice(0, 3000);
    const m    = head.match(/@db-write\s+([^\n*]+)/);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

// ─── Vérification d'un manifest ───────────────────────────────────────────

function checkManifest(m) {
  const errors   = []; // bloquants en --strict
  const warnings = []; // toujours warnings

  const name = m.name || m._file;
  const cl   = m.classification;

  // ── Warning : classification absente ──────────────────────────────────────
  if (!cl) {
    warnings.push({
      type: 'CLASSIFICATION-MISSING',
      feature: name,
      msg: 'champ `classification` absent — ajouter lors du prochain changement de ce manifest (ratchet phase 2)',
    });
    return { errors, warnings };
  }

  // ── Erreur bloquante : kind non autorisé ───────────────────────────────────
  if (!cl.kind) {
    errors.push({ type: 'KIND-MISSING', feature: name, msg: '`classification.kind` manquant' });
  } else if (!ALLOWED_KINDS.has(cl.kind)) {
    const hint = cl.kind === 'projection'
      ? ' — "projection" est un verdict de rattachement, jamais un kind (FEATURE_DOCTRINE.md §Schéma de classification)'
      : '';
    errors.push({ type: 'KIND-INVALID', feature: name, msg: `kind "${cl.kind}" non autorisé${hint}` });
  }

  // ── Erreur bloquante : decision non autorisée ─────────────────────────────
  if (cl.decision && !ALLOWED_DECISIONS.has(cl.decision)) {
    errors.push({ type: 'DECISION-INVALID', feature: name, msg: `decision "${cl.decision}" non autorisée` });
  }

  // ── Erreur bloquante : externalSideEffect hors whitelist ──────────────────
  const eff = cl.signals?.externalSideEffect;
  if (eff !== undefined && !ALLOWED_EXTERNAL_SIDE_EFFECTS.has(eff)) {
    errors.push({
      type: 'SIDEEFFECT-INVALID', feature: name,
      msg: `signals.externalSideEffect "${eff}" non autorisé — valeurs : ${[...ALLOWED_EXTERNAL_SIDE_EFFECTS].join(' | ')}`,
    });
  }

  // ── Erreur bloquante : aggregation-readonly avec @db-write ────────────────
  if (cl.kind === 'aggregation-readonly') {
    const allFiles = [
      ...(m.files?.services || []),
      ...(m.files?.routes   || []),
    ];
    for (const f of allFiles) {
      const dbWrite = readDbWrite(f);
      if (dbWrite && dbWrite !== '(none)' && dbWrite !== '@unknown') {
        errors.push({
          type: 'AGGREGATION-WRITES', feature: name,
          msg: `kind "aggregation-readonly" mais ${f} a @db-write: ${dbWrite}`,
        });
      }
    }
  }

  // ── Erreur bloquante : technical-transversal avec migrations métier ────────
  if (cl.kind === 'technical-transversal') {
    const migs = m.files?.migrations || [];
    if (migs.length > 0) {
      errors.push({
        type: 'TECH-TRANSVERSAL-HAS-MIGRATIONS', feature: name,
        msg: `kind "technical-transversal" ne doit pas déclarer de migrations métier (${migs.length} trouvée(s))`,
      });
    }
  }

  // ── Erreur bloquante : perimeter.out absent sur feature production ─────────
  if (m.status === 'production' && m.type !== 'transversal') {
    const out = m.perimeter?.out;
    if (!out || !Array.isArray(out) || out.length === 0) {
      errors.push({
        type: 'PERIMETER-OUT-MISSING', feature: name,
        msg: 'perimeter.out absent ou vide pour une feature production — documenter ce que la feature ne fait pas',
      });
    }
  }

  // ── Warning : rationale absent ou trop court ───────────────────────────────
  const rationale = cl.rationale;
  if (!rationale || !Array.isArray(rationale) || rationale.length < 2) {
    warnings.push({
      type: 'RATIONALE-SHORT', feature: name,
      msg: `rationale absent ou < 2 entrées (${rationale?.length ?? 0}) — documenter au moins 2 raisons objectives`,
    });
  }

  // ── Warning : multiConsumer:true sans consommateurs déclarés ──────────────
  if (cl.signals?.multiConsumer === true) {
    const consumes = m.contract?.consumes || [];
    if (consumes.length === 0) {
      warnings.push({
        type: 'MULTICONSUMER-UNDECLARED', feature: name,
        msg: 'signals.multiConsumer:true mais contract.consumes est vide — lister les features consommatrices',
      });
    }
  }

  // ── Warning : ownsMigrations:true sans migrations déclarées ───────────────
  if (cl.signals?.ownsMigrations === true) {
    const migs = m.files?.migrations || [];
    if (migs.length === 0) {
      warnings.push({
        type: 'OWNS-MIGRATIONS-EMPTY', feature: name,
        msg: 'signals.ownsMigrations:true mais files.migrations est vide — déclarer les migrations',
      });
    }
  }

  // ── Warning : effet externe sans invariant associé ────────────────────────
  if (eff && eff !== 'none') {
    const invs = m.invariants || [];
    const hasEffectInvariant = invs.some(inv => {
      const text = typeof inv === 'string' ? inv : (inv && typeof inv.statement === 'string' ? inv.statement : '');
      return /idempotence|webhook|stripe|paypal|whatsapp|meta|outbound|message|payment|refund|rembours|auth[- ]?token|token/i.test(text);
    });
    if (!hasEffectInvariant) {
      warnings.push({
        type: 'SIDEEFFECT-NO-INVARIANT', feature: name,
        msg: `externalSideEffect "${eff}" mais aucun invariant lié (idempotence, webhook…) — documenter la garantie`,
      });
    }
  }

  return { errors, warnings };
}

// ─── Main ──────────────────────────────────────────────────────────────────

function run() {
  const manifests = loadManifests();
  const allErrors = [];
  const allWarnings = [];

  const summary = {
    total:       0,
    classified:  0,
    unclassified: 0,
    errors:      0,
    warnings:    0,
    by_kind:     {},
  };

  for (const m of manifests) {
    if (m._loadError) {
      allErrors.push({ type: 'MANIFEST-LOAD-ERROR', feature: m._file, msg: m._loadError });
      continue;
    }
    summary.total++;
    if (m.classification?.kind) {
      summary.classified++;
      summary.by_kind[m.classification.kind] = (summary.by_kind[m.classification.kind] || 0) + 1;
    } else {
      summary.unclassified++;
    }

    const { errors, warnings } = checkManifest(m);
    allErrors.push(...errors);
    allWarnings.push(...warnings);
  }

  summary.errors   = allErrors.length;
  summary.warnings = allWarnings.length;

  // ── Sortie JSON ───────────────────────────────────────────────────────────
  if (JSON_OUTPUT) {
    console.log(JSON.stringify({ summary, errors: allErrors, warnings: allWarnings }, null, 2));
    if (STRICT && (allErrors.length > 0 || allWarnings.length > 0)) process.exit(1);
    return;
  }

  // ── Sortie lisible ────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  Feature Classification Check — Komerce                  ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  console.log(`  Manifests analysés  : ${summary.total}`);
  console.log(`  Classifiés          : ${summary.classified}`);
  console.log(`  Non classifiés      : ${summary.unclassified}  ${summary.unclassified > 0 ? '(warning — ratchet phase 1)' : '✅'}`);

  if (Object.keys(summary.by_kind).length > 0) {
    console.log('\n  Répartition par kind :');
    for (const [kind, count] of Object.entries(summary.by_kind)) {
      console.log(`    ${kind.padEnd(26)} : ${count}`);
    }
  }

  if (allErrors.length > 0) {
    console.log(`\n  ❌ ${allErrors.length} violation(s) bloquante(s)${STRICT ? ' — exit(1)' : ' — (warnings en mode normal)'}\n`);
    for (const e of allErrors) {
      console.log(`  [${e.type}] ${e.feature}`);
      console.log(`    → ${e.msg}\n`);
    }
  }

  if (allWarnings.length > 0) {
    console.log(`  ⚠️  ${allWarnings.length} avertissement(s)\n`);
    for (const w of allWarnings) {
      console.log(`  [${w.type}] ${w.feature}`);
      console.log(`    → ${w.msg}\n`);
    }
  }

  if (allErrors.length === 0 && allWarnings.length === 0) {
    console.log('  ✅ Classification propre — tous les manifests vérifiés.\n');
  } else if (allErrors.length === 0) {
    console.log('  ✅ Aucune violation bloquante.\n');
  }

  const ratchetPhase = summary.unclassified === 0 ? 'Phase 2+ (tous classifiés)' : 'Phase 1 (backfill en cours)';
  console.log(`  Ratchet : ${ratchetPhase}\n`);

  if (STRICT && (allErrors.length > 0 || allWarnings.length > 0)) {
    console.log('  ── Mode --strict : toute erreur OU dette de classification résiduelle bloque — exit(1)\n');
    process.exit(1);
  }
}

run();
