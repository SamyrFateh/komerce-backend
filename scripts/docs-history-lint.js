#!/usr/bin/env node
'use strict';

/**
 * @komerce-arch
 * @domain        governance
 * @type          gate
 *
 * docs-history-lint.js — Gate 5 : anti-historique hors archive.
 *
 *   Empêche le bruit documentaire de revenir après la passe de consolidation.
 *   Principe : un fichier portant des signaux historiques (date dans le nom,
 *   préfixe de rapport ponctuel, lot de changelog…) n'a sa place QUE dans
 *   docs/_archive/ ou une sous-archive. Partout ailleurs → merge bloqué.
 *
 *   Source de vérité des docs vivants : docs/README.md.
 *   La règle d'or : « Tout document non listé dans docs/README.md est historique. »
 *   Ce linter applique la couche complémentaire : les noms à signaux historiques
 *   ne peuvent pas rentrer dans l'espace vivant, même si quelqu'un oublie de les
 *   lister dans README.md.
 *
 *   Calibré sur la structure réelle du repo Komerce :
 *     - docs/_archive/       → zone légale pour tout signal historique
 *     - docs/_agent/         → workspace agent, exclu de la gouvernance doc
 *     - docs/chantier/       → zone de travail en cours, partiellement tolérée
 *     - docs/doctrine/       → doctrines actives, jamais de signaux historiques
 *     - racine repo          → AGENTS.md, README.md, PROCEDURE.md → exemptés
 *
 * Usage :
 *   node scripts/docs-history-lint.js              rapport
 *   node scripts/docs-history-lint.js --strict     exit 1 si violation
 *   node scripts/docs-history-lint.js --root DIR
 *   node scripts/docs-history-lint.js --verbose    affiche aussi les fichiers OK
 */

const fs   = require('fs');
const path = require('path');

const args   = process.argv.slice(2);
const STRICT  = args.includes('--strict');
const VERBOSE = args.includes('--verbose');
const ROOT    = path.resolve(argVal('--root') || process.cwd());

function argVal(f) { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; }
const C = { red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m', dim: '\x1b[2m', bld: '\x1b[1m', cyn: '\x1b[36m', r: '\x1b[0m' };

// ── Zones autorisées pour les signaux historiques ──────────────────────────
// Tout fichier dans ces chemins peut porter n'importe quel nom.
const ARCHIVE_ZONES = [
  'docs/_archive',
  'docs/_agent',          // workspace agent interne, pas de gouvernance doc
  'archive',              // archive racine si elle existe
];

// ── Zones tolérées (chantier en cours) ────────────────────────────────────
// Les signaux historiques y déclenchent un avertissement, pas un bloquant.
// Raison : STATUS.md, dettes nommées, roadmap partielle → légitimes en chantier.
const WARN_ZONES = [
  'docs/chantier',
];

// ── Fichiers racine exemptés ───────────────────────────────────────────────
// Ces fichiers vivent à la racine avec des noms conventionnels imposés.
const EXEMPT_FILES = new Set([
  'AGENTS.md', 'README.md', 'CONTRIBUTING.md', 'PROCEDURE.md',
  'RECONCILIATION_PROD.sql',  // fichier de migration ponctuel nommé explicitement
  'PROMPT_AUDIT_PREGOLIVE.md', // audit pré-golive — à archiver après golive
  'AUDIT_FEATURE_DOCTRINE.md', // doctrine d'audit active
]);

// ── Signaux historiques dans le nom de fichier ────────────────────────────
//
// Un signal = un pattern qui indique que le fichier est ponctuel / daté /
// rapport de session, et n'a pas sa place dans l'espace vivant.
//
// Calibré sur les noms réels trouvés dans docs/_archive/ de Komerce.
const HISTORY_SIGNALS = [

  // Date explicite dans le nom (YYYY-MM-DD ou YYYY-MM ou juste YYYY en milieu de nom)
  { rx: /\d{4}-\d{2}-\d{2}/, label: 'date YYYY-MM-DD dans le nom' },
  { rx: /\d{4}-\d{2}(?!\d)/,  label: 'date YYYY-MM dans le nom' },

  // Préfixes de rapport/audit ponctuel
  { rx: /^RAPPORT_/i,         label: 'préfixe RAPPORT_' },
  { rx: /^AUDIT_/i,           label: 'préfixe AUDIT_' },
  { rx: /^SUMMARY_?/i,        label: 'préfixe SUMMARY' },
  { rx: /^CORRECTIONS_/i,     label: 'préfixe CORRECTIONS_' },
  { rx: /^APPLIQUEES_?/i,     label: 'préfixe APPLIQUEES' },
  { rx: /^SIGNOFF_/i,         label: 'préfixe SIGNOFF_' },
  { rx: /^VALIDATION_GUIDE/i, label: 'VALIDATION_GUIDE (guide ponctuel)' },

  // Lots de changelog / migration nommés
  { rx: /^CHANGELOG-/i,       label: 'préfixe CHANGELOG-' },
  { rx: /^CHANGES_/i,         label: 'préfixe CHANGES_' },
  { rx: /^PATCH_/i,           label: 'préfixe PATCH_' },
  { rx: /^READY_TO_/i,        label: 'préfixe READY_TO_ (correctif ponctuel)' },

  // Prompts de session nommés
  { rx: /^PROMPT_/i,          label: 'préfixe PROMPT_ (prompt de session)' },
  { rx: /^REPRISE_/i,         label: 'préfixe REPRISE_ (reprise de session)' },

  // Phases numérotées ponctuelles (P4_1, PHASE-1-…)
  { rx: /^P\d+_\d+_/,         label: 'phase numérotée P{n}_{n}_' },
  { rx: /^PHASE-\d+-/i,       label: 'préfixe PHASE-{n}-' },

  // Roadmap / plan ponctuel
  { rx: /^ROADMAP_/i,         label: 'préfixe ROADMAP_ (plan ponctuel)' },

  // Bootstrap / initialisation unique
  { rx: /^GOVERNANCE_BOOTSTRAP/i, label: 'GOVERNANCE_BOOTSTRAP (init unique)' },
  { rx: /^RECONCILIATION_\d{4}/i, label: 'RECONCILIATION datée' },
];

// ── Collecte des .md hors archive ─────────────────────────────────────────
function collectMd(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs  = path.join(dir, entry.name);
    const rel  = path.relative(ROOT, abs).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      // Ne descend pas dans les zones archivées
      if (ARCHIVE_ZONES.some(z => rel === z || rel.startsWith(z + '/'))) continue;
      if (rel === 'node_modules' || rel.startsWith('node_modules/'))     continue;
      collectMd(abs, results);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push({ abs, rel, name: entry.name });
    }
  }
  return results;
}

// ── Analyse d'un fichier ───────────────────────────────────────────────────
function analyze(file) {
  // Exemption racine
  if (!file.rel.includes('/') && EXEMPT_FILES.has(file.name)) {
    return { status: 'exempt', signals: [] };
  }
  const signals = HISTORY_SIGNALS.filter(s => s.rx.test(file.name));
  if (!signals.length) return { status: 'ok', signals: [] };

  const inWarn = WARN_ZONES.some(z => file.rel.startsWith(z + '/') || file.rel === z);
  return { status: inWarn ? 'warn' : 'violation', signals };
}

// ── Main ───────────────────────────────────────────────────────────────────
// Scan docs/ + racine .md uniquement (pas les sous-répertoires racine sauf docs)
const scanDirs = [
  path.join(ROOT, 'docs'),
  ROOT,   // pour les .md à la racine directement
];

// Collecte spéciale racine : un seul niveau (pas récursif pour la racine)
function collectRootMd() {
  const results = [];
  if (!fs.existsSync(ROOT)) return results;
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const abs = path.join(ROOT, entry.name);
      const rel = entry.name;
      results.push({ abs, rel, name: entry.name });
    }
  }
  return results;
}

const files = [
  ...collectMd(path.join(ROOT, 'docs')),
  ...collectRootMd(),
];

console.log(`\n${C.bld}Gate 5 — Linter anti-historique hors archive${C.r}  ${C.dim}(${files.length} .md scannés)${C.r}\n`);

const violations = [];
const warnings   = [];
let okCount      = 0;

for (const file of files) {
  const { status, signals } = analyze(file);

  if (status === 'exempt') {
    if (VERBOSE) console.log(`  ${C.dim}–  ${file.rel} (exempté)${C.r}`);
    continue;
  }
  if (status === 'ok') {
    okCount++;
    if (VERBOSE) console.log(`  ${C.grn}✔${C.r}  ${file.rel}`);
    continue;
  }
  if (status === 'warn') {
    warnings.push({ file, signals });
    console.log(`  ${C.ylw}▲${C.r}  ${file.rel}  ${C.dim}→ ${signals.map(s => s.label).join(', ')} (zone chantier — non bloquant)${C.r}`);
    continue;
  }
  // violation
  violations.push({ file, signals });
  console.log(`  ${C.red}✖${C.r}  ${C.bld}${file.rel}${C.r}`);
  signals.forEach(s => console.log(`       ${C.red}↳ ${s.label}${C.r}`));
  console.log(`       ${C.dim}→ déplace vers docs/_archive/ ou renomme sans signal historique.${C.r}`);
}

console.log(`\n${C.bld}Bilan${C.r} : ${C.grn}${okCount} ok${C.r} · ${C.ylw}${warnings.length} avertissement(s)${C.r} · ${C.red}${violations.length} violation(s) bloquante(s)${C.r}`);

if (violations.length) {
  console.log(`\n${C.red}${C.bld}✖ Gate 5 ÉCHEC — ${violations.length} fichier(s) historique(s) hors archive :${C.r}`);
  violations.forEach(({ file }) => console.log(`${C.red}   ↳ ${file.rel}${C.r}`));
  console.log(`\n${C.dim}Règle : un fichier à signal historique ne vit que dans docs/_archive/.${C.r}`);
  console.log(`${C.dim}Checkpoint humain si ambigu : classer "À REVOIR" dans docs/chantier/STATUS.md.${C.r}`);
  if (STRICT) process.exit(1);
}

if (!violations.length) {
  console.log(`\n${C.grn}${C.bld}✔ Gate 5 OK — Aucun fichier historique hors archive.${C.r}`);
}
