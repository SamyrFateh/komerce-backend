#!/usr/bin/env node
'use strict';

/**
 * map-check.js — Gate 6 : agrégateur de reconstruction (map:check).
 *
 *   Prouve en une commande que la big map est reconstructible et que
 *   l'invariant de gouvernance tient. C'est le point d'entrée unique
 *   pour la CI — si map:check est vert, le système est cohérent.
 *
 *   Principe : enchaîne tous les checks de reconstruction et de gouvernance
 *   dans l'ordre de dépendance, collecte les résultats, produit un bilan
 *   structuré. Un seul échec = exit 1. Zéro exception silencieuse.
 *
 *   Chaque step est :
 *     - nommé (label lisible dans les logs CI)
 *     - catégorisé (reconstruction | gouvernance | gate)
 *     - configuré : bloquant (défaut) ou avertissement (--warn-only flag)
 *     - conditionnel : skippé si la commande n'existe pas dans package.json
 *       (adoption progressive — on n'échoue pas sur un check non encore écrit)
 *
 * Usage :
 *   node scripts/map-check.js              # mode normal
 *   node scripts/map-check.js --verbose    # affiche stdout de chaque step
 *   node scripts/map-check.js --root DIR   # racine du repo
 *   node scripts/map-check.js --bail       # stoppe au premier échec
 *
 * Intégration package.json :
 *   "map:check": "node scripts/map-check.js"
 *
 * Intégration CI (GitHub Actions) :
 *   - run: npm run map:check
 */

const fs   = require('fs');
const path = require('path');
const cp   = require('child_process');

const args    = process.argv.slice(2);
const ROOT    = path.resolve(argVal('--root') || process.cwd());
const VERBOSE = args.includes('--verbose');
const BAIL    = args.includes('--bail');

function argVal(f) { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; }

const C = {
  red:  '\x1b[31m', grn:  '\x1b[32m', ylw:  '\x1b[33m',
  cyn:  '\x1b[36m', dim:  '\x1b[2m',  bld:  '\x1b[1m',
  mag:  '\x1b[35m', r:    '\x1b[0m',
};

// ── Définition des steps ────────────────────────────────────────────────────
//
//   cmd       : commande shell à exécuter (depuis ROOT)
//   label     : nom lisible dans le rapport
//   category  : 'reconstruction' | 'gouvernance' | 'gate'
//   warn      : si true, un échec ne bloque pas le gate global (dette connue)
//   npmScript : si fourni, la commande n'est lancée QUE si ce script existe
//               dans package.json (adoption progressive)
//
const STEPS = [
  // ── Reconstruction des cartes ──────────────────────────────────────────
  {
    label:     'Registre des features',
    category:  'reconstruction',
    npmScript: 'feature:registry',
    cmd:       'npm run feature:registry',
  },
  {
    label:     'Check des features (orphelins, conflits)',
    category:  'gouvernance',
    npmScript: 'feature:check',
    cmd:       'npm run feature:check',
    warn:      true,
  },
  {
    label:     'Feature classification check (ratchet phase 1)',
    category:  'gouvernance',
    npmScript: 'feature:classification',
    cmd:       'npm run feature:classification',
    warn:      true,  // warning-only — passer en bloquant dès phase 3 (backfill terminé)
  },

  // ── Gate 1 : fichiers touchés → carte ─────────────────────────────────
  {
    label:    'Gate 1 — Fichiers touchés → carte',
    category: 'gate',
    cmd:      'node scripts/touched-files-feature-gate.js',
  },

  // ── Gate 2 : schéma des cartes ─────────────────────────────────────────
  {
    label:    'Gate 2 — Schéma strict des cartes',
    category: 'gate',
    cmd:      'node scripts/feature-schema-check.js --strict --full',
  },

  // ── Gate 2b : invariants exécutables (P1 Bloc B) ──────────────────────
  // Vérifie que tout invariant déclaré sous forme { statement, test }
  // référence un fichier existant ET que ce test passe.
  // Mode --strict : exit 1 si un invariant est rouge.
  // env JWT_SECRET requis pour le test auth-identity (gen-security-360).
  {
    label:    'Gate 2b — Invariants exécutables (feature-invariant-check)',
    category: 'gate',
    cmd:      'node scripts/feature-invariant-check.js --strict',
  },

  // ── Reconstruction architecture ────────────────────────────────────────
  {
    label:     'Arch gate (headers + graphe + schema drift)',
    category:  'gate',
    npmScript: 'arch:gate',
    cmd:       'npm run arch:gate',
  },

  // ── Business Feature Graph (Lot O3) ─────────────────────────────────────
  // Résout le pont feature <-> fichier/table/route à partir du Technical
  // Architecture Graph ci-dessus (arch:gate) et des manifests
  // features/*.feature.js, capabilities/*.capability.js, et — quand montés —
  // des dépôts boutique/dash (KOMERCE_BOUTIQUE_ROOT / KOMERCE_DASH_ROOT,
  // défaut ../boutique / ../dash). Validé standalone (0 error, déterministe
  // sur deux exécutions) avant activation ici.
  {
    label:     'Business Feature Graph (Lot O3)',
    category:  'gate',
    npmScript: 'business-graph:check',
    cmd:       'npm run business-graph:check',
  },

  // ── Drift ratchet typé du Business Feature Graph (Lot O4 / O4-2) ────────
  // Compare le nombre de warnings PAR CLÉ TYPE::CATÉGORIE SÉMANTIQUE à
  // governance/business-graph-drift-baseline.json (Lot O4-2 point 2 : la
  // granularité type-seul de Phase F laissait passer un déplacement de dette
  // entre catégories au sein d'un même type — corrigé).
  // BLOQUANT (Lot O4-2 point 1) : la revue humaine des ACTIONABLE_DRIFT
  // identifiés (voir governance/business-graph-warning-semantics.js) a eu
  // lieu, la baseline typée est stable et vérifiée déterministe sur deux
  // générations successives — plus de raison de rester en adoption
  // progressive. Toute augmentation d'une clé type::catégorie, ou toute
  // nouvelle clé non budgétisée, bloque désormais le gate au même titre que
  // le Business Feature Graph lui-même.
  {
    label:     'Business Feature Graph — drift ratchet typé (Lot O4-2, bloquant)',
    category:  'gate',
    npmScript: 'business-graph:ratchet-check',
    cmd:       'npm run business-graph:ratchet-check',
  },

  // ── Lot O6 — Feature Dependency Disposition ─────────────────────────────
  // Classifie les 94 paires OBSERVED_UNDECLARED du Lot O5 en familles
  // architecturales dérivées des preuves (jamais du nom), gouverne le ledger
  // d'exceptions et la couverture des ontology gaps (ex. `tracking`). Ne
  // réobserve rien, ne modifie pas le ratchet O5 ci-dessus. Bloquant :
  // UNCLASSIFIED_OBSERVED_DEPENDENCY, STALE/DUPLICATE/MISSING/ILLEGITIMATE
  // exception, UNEXPLAINED_RUNTIME_CYCLE, UNCOVERED_LOCAL_MANIFEST_GAP,
  // REVIEW_REQUIRED. Validé standalone (0 violation, déterministe) avant
  // activation ici — voir docs/LOT_O6_LIVRABLE.md.
  {
    label:     'Business Feature Graph — dependency disposition (Lot O6, bloquant)',
    category:  'gate',
    npmScript: 'business-graph:disposition-check',
    cmd:       'npm run business-graph:disposition-check',
  },

  // ── Lot O8 — Feature 360 (business piloting projection) ────────────────
  // Projection déterministe de lecture au-dessus de la chaîne Feature First
  // O2-O7.3 déjà gouvernée (aucune nouvelle vérité, aucun registre parallèle).
  // Bloquant : artefact périmé (stale), duplicate feature id, fuite de bruit
  // technique/projection dans businessDependencies, mismatch consumes/
  // consumedBy, dette inventée sans signal source. Voir docs/LOT_O8_FEATURE_360_LIVRABLE.md.
  {
    label:     'Feature 360 — projection de pilotage business (Lot O8, bloquant)',
    category:  'gate',
    npmScript: 'feature:360:check',
    cmd:       'npm run feature:360:check',
  },

  // ── Reconstructions 360 ────────────────────────────────────────────────
  {
    label:     'Dashboard 360 check',
    category:  'reconstruction',
    npmScript: 'dashboards:360:check',
    cmd:       'npm run dashboards:360:check',
  },
  {
    label:     'Boutique 360 check',
    category:  'reconstruction',
    npmScript: 'boutique:360:check',
    cmd:       'npm run boutique:360:check',
  },
  {
    label:     'Boutique ownership check',
    category:  'gate',
    npmScript: 'gate:boutique-ownership',
    cmd:       'npm run gate:boutique-ownership',
  },
  {
    label:     'Boutique full ownership scan',
    category:  'gate',
    npmScript: 'gate:boutique-ownership:full',
    cmd:       'npm run gate:boutique-ownership:full',
    warn:      true,
  },
  {
    label:     'Security 360 check',
    category:  'reconstruction',
    npmScript: 'security:360:check',
    cmd:       'npm run security:360:check',
  },

  // ── Meta graph ─────────────────────────────────────────────────────────
  {
    label:     'Meta graph check',
    category:  'reconstruction',
    npmScript: 'meta:graph:check',
    cmd:       'npm run meta:graph:check',
  },

  // ── Gate 4 : feature audit (tests liés aux cartes) ─────────────────────
  {
    label:    'Gate 4 — Feature audit (tests liés aux cartes)',
    category: 'gate',
    cmd:      'node scripts/feature-audit.js --strict',
  },

  // ── Gate 5 : linter anti-historique ────────────────────────────────────
  {
    label:    'Gate 5 — Linter anti-historique hors archive',
    category: 'gate',
    cmd:      'node scripts/docs-history-lint.js --strict',
  },
];

// ── Lecture de package.json pour skip conditionnel ─────────────────────────
function loadNpmScripts() {
  const pkg = path.join(ROOT, 'package.json');
  if (!fs.existsSync(pkg)) return {};
  try { return JSON.parse(fs.readFileSync(pkg, 'utf8')).scripts || {}; } catch { return {}; }
}

// ── Exécution d'un step ────────────────────────────────────────────────────
function runStep(step, npmScripts) {
  // Skip conditionnel : script npm non déclaré → adoption progressive
  if (step.npmScript && !npmScripts[step.npmScript]) {
    return { status: 'skipped', reason: `npm script "${step.npmScript}" absent` };
  }
  // Skip si le script node n'existe pas encore
  if (step.cmd.startsWith('node scripts/')) {
    const scriptPath = path.join(ROOT, step.cmd.replace(/^node /, '').split(' ')[0]);
    if (!fs.existsSync(scriptPath)) {
      return { status: 'skipped', reason: `script absent : ${step.cmd}` };
    }
  }

  const t0 = Date.now();
  try {
    const out = cp.execSync(step.cmd, {
      cwd:      ROOT,
      encoding: 'utf8',
      stdio:    ['ignore', 'pipe', 'pipe'],
    });
    return { status: 'ok', ms: Date.now() - t0, stdout: out };
  } catch (e) {
    return {
      status: step.warn ? 'warn' : 'fail',
      ms:     Date.now() - t0,
      stdout: (e.stdout || '') + (e.stderr || ''),
      code:   e.status,
    };
  }
}

// ── Affichage d'un step ────────────────────────────────────────────────────
function categoryColor(cat) {
  return { reconstruction: C.cyn, gouvernance: C.mag, gate: C.ylw }[cat] || C.dim;
}

function printStep(step, result, idx, total) {
  const n      = String(idx + 1).padStart(2);
  const catCol = categoryColor(step.category);
  const catTag = `${catCol}[${step.category}]${C.r}`;

  if (result.status === 'ok') {
    const ms = result.ms ? `${C.dim} ${result.ms}ms${C.r}` : '';
    console.log(`  ${C.grn}✔${C.r} ${n}/${total} ${catTag} ${step.label}${ms}`);
    if (VERBOSE && result.stdout) {
      result.stdout.trimEnd().split('\n').forEach(l => console.log(`      ${C.dim}${l}${C.r}`));
    }
  } else if (result.status === 'skipped') {
    console.log(`  ${C.dim}–  ${n}/${total} ${catTag} ${step.label}  (skipped: ${result.reason})${C.r}`);
  } else if (result.status === 'warn') {
    console.log(`  ${C.ylw}▲${C.r} ${n}/${total} ${catTag} ${step.label}  ${C.ylw}(avertissement — non bloquant)${C.r}`);
    if (result.stdout) result.stdout.trimEnd().split('\n').forEach(l => console.log(`      ${C.ylw}${l}${C.r}`));
  } else {
    console.log(`  ${C.red}✖${C.r} ${n}/${total} ${catTag} ${C.bld}${step.label}${C.r}  ${C.red}(exit ${result.code})${C.r}`);
    if (result.stdout) result.stdout.trimEnd().split('\n').forEach(l => console.log(`      ${C.red}${l}${C.r}`));
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
const npmScripts = loadNpmScripts();
const total      = STEPS.length;
const results    = [];

console.log(`\n${C.bld}map:check — Reconstruction & gouvernance${C.r}  ${C.dim}(${total} steps, racine ${ROOT})${C.r}\n`);

for (let i = 0; i < STEPS.length; i++) {
  const step   = STEPS[i];
  const result = runStep(step, npmScripts);
  results.push({ step, result });
  printStep(step, result, i, total);
  if (BAIL && result.status === 'fail') {
    console.log(`\n${C.red}${C.bld}✖ Arrêt immédiat (--bail). Corrige l'étape ci-dessus.${C.r}`);
    process.exit(1);
  }
}

// ── Bilan ──────────────────────────────────────────────────────────────────
const ok       = results.filter(r => r.result.status === 'ok').length;
const skipped  = results.filter(r => r.result.status === 'skipped').length;
const warned   = results.filter(r => r.result.status === 'warn').length;
const failed   = results.filter(r => r.result.status === 'fail');

console.log('\n' + '─'.repeat(60));
console.log(`${C.bld}Bilan${C.r} : ${C.grn}${ok} ok${C.r} · ${C.dim}${skipped} skippé(s)${C.r} · ${C.ylw}${warned} avertissement(s)${C.r} · ${C.red}${failed.length} échec(s)${C.r}`);

if (warned) {
  console.log(`${C.ylw}▲ ${warned} check(s) non bloquant(s) — dette à résorber.${C.r}`);
}

if (failed.length) {
  console.log(`\n${C.red}${C.bld}✖ map:check ÉCHEC — ${failed.length} step(s) bloquant(s) :${C.r}`);
  failed.forEach(({ step }) => console.log(`${C.red}   ↳ ${step.label}${C.r}`));
  console.log(`\n${C.dim}L'invariant « la big map est reconstructible » n'est pas satisfait.${C.r}`);
  console.log(`${C.dim}Corrige les steps en échec avant tout merge.${C.r}`);
  process.exit(1);
}

console.log(`\n${C.grn}${C.bld}✔ map:check OK — La big map est reconstructible. Gouvernance satisfaite.${C.r}`);
