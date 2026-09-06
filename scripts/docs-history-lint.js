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
 *   docs/_archive/ ou une sous-archive.
 *
 *   Mode courant : cliquet. La dette historique existante est gelée dans
 *   scripts/.docs-history-lint-baseline.json et ne bloque pas tant qu'elle ne
 *   grossit pas. Toute nouvelle entrée hors baseline bloque en --strict.
 *   Mode --full : ignore la baseline et bloque toute dette restante.
 *
 * Usage :
 *   node scripts/docs-history-lint.js              rapport
 *   node scripts/docs-history-lint.js --strict     exit 1 si nouvelle violation
 *   node scripts/docs-history-lint.js --strict --full   bloque aussi la baseline
 *   node scripts/docs-history-lint.js --save       régénère/rétrécit la baseline
 *   node scripts/docs-history-lint.js --root DIR
 *   node scripts/docs-history-lint.js --verbose    affiche aussi les fichiers OK
 */

const fs   = require('fs');
const path = require('path');

const args    = process.argv.slice(2);
const STRICT  = args.includes('--strict');
const FULL    = args.includes('--full');
const SAVE    = args.includes('--save');
const VERBOSE = args.includes('--verbose');
const ROOT    = path.resolve(argVal('--root') || process.cwd());

if (SAVE && process.env.CI) {
  console.error('\x1b[31m✖ --save refusé en environnement CI (process.env.CI détecté).\x1b[0m');
  console.error('  La baseline docs-history-lint ne se régénère qu\'en local, par décision humaine.');
  console.error('  La CI ne doit appeler que `npm run gate:docs-lint` ou le mode --full de contrôle.');
  process.exit(1);
}

function argVal(f) { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; }
const C = { red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m', dim: '\x1b[2m', bld: '\x1b[1m', cyn: '\x1b[36m', r: '\x1b[0m' };
const BASELINE_FILE = path.join(__dirname, '.docs-history-lint-baseline.json');

// ── Baseline RATCHET ───────────────────────────────────────────────────────
// Liste nominative des fichiers historiques hors archive existants avant le
// durcissement du gate. --save amorce ou rétrécit cette dette ; il ne l'agrandit
// jamais après amorçage. Une entrée retirée de la baseline doit le rester.
function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) {
    if (!FULL) console.log(`${C.dim}(pas de baseline docs-history-lint — toutes les violations seront nouvelles)${C.r}`);
    return new Set();
  }
  let raw;
  try { raw = fs.readFileSync(BASELINE_FILE, 'utf8').replace(/^\uFEFF/, ''); }
  catch (e) {
    console.log(`${C.ylw}⚠ Baseline docs illisible (${e.message}) — traitée comme vide.${C.r}`);
    return new Set();
  }
  try {
    const parsed = JSON.parse(raw);
    return new Set(parsed.exempt || []);
  } catch (e) {
    console.log(`${C.red}⚠ Baseline docs JSON invalide (${e.message.slice(0,80)}) — traitée comme vide.${C.r}`);
    return new Set();
  }
}

function saveBaseline(rawViolations, oldBaseline, isBootstrap) {
  const current = new Set(rawViolations.map(v => v.file.rel));
  const next = isBootstrap
    ? [...current].sort()
    : [...current].filter(rel => oldBaseline.has(rel)).sort();

  fs.writeFileSync(BASELINE_FILE, JSON.stringify({
    _doctrine: 'Cliquet : ne peut que rétrécir. Une entrée retirée d\'ici doit le rester. Régénéré par --save.',
    _updated: new Date().toISOString().slice(0, 10),
    exempt: next,
  }, null, 2) + '\n');
  return next;
}

// ── Zones autorisées pour les signaux historiques ──────────────────────────
const ARCHIVE_ZONES = [
  'docs/_archive',
  'docs/_agent',
  'archive',
];

// ── Zones tolérées (chantier en cours) ────────────────────────────────────
const WARN_ZONES = [
  'docs/chantier',
];

// ── Fichiers racine exemptés ───────────────────────────────────────────────
const EXEMPT_FILES = new Set([
  'AGENTS.md', 'README.md', 'CONTRIBUTING.md', 'PROCEDURE.md',
  'RECONCILIATION_PROD.sql',
  'PROMPT_AUDIT_PREGOLIVE.md',
  'AUDIT_FEATURE_DOCTRINE.md',
]);

// ── Signaux historiques dans le nom de fichier ────────────────────────────
const HISTORY_SIGNALS = [
  { rx: /\d{4}-\d{2}-\d{2}/, label: 'date YYYY-MM-DD dans le nom' },
  { rx: /\d{4}-\d{2}(?!\d)/,  label: 'date YYYY-MM dans le nom' },
  { rx: /^RAPPORT_/i,         label: 'préfixe RAPPORT_' },
  { rx: /^AUDIT_/i,           label: 'préfixe AUDIT_' },
  { rx: /^SUMMARY_?/i,        label: 'préfixe SUMMARY' },
  { rx: /^CORRECTIONS_/i,     label: 'préfixe CORRECTIONS_' },
  { rx: /^APPLIQUEES_?/i,     label: 'préfixe APPLIQUEES' },
  { rx: /^SIGNOFF_/i,         label: 'préfixe SIGNOFF_' },
  { rx: /^VALIDATION_GUIDE/i, label: 'VALIDATION_GUIDE (guide ponctuel)' },
  { rx: /^CHANGELOG-/i,       label: 'préfixe CHANGELOG-' },
  { rx: /^CHANGES_/i,         label: 'préfixe CHANGES_' },
  { rx: /^PATCH_/i,           label: 'préfixe PATCH_' },
  { rx: /^READY_TO_/i,        label: 'préfixe READY_TO_ (correctif ponctuel)' },
  { rx: /^PROMPT_/i,          label: 'préfixe PROMPT_ (prompt de session)' },
  { rx: /^REPRISE_/i,         label: 'préfixe REPRISE_ (reprise de session)' },
  { rx: /^P\d+_\d+_/,         label: 'phase numérotée P{n}_{n}_' },
  { rx: /^PHASE-\d+-/i,       label: 'préfixe PHASE-{n}-' },
  { rx: /^ROADMAP_/i,         label: 'préfixe ROADMAP_ (plan ponctuel)' },
  { rx: /^GOVERNANCE_BOOTSTRAP/i, label: 'GOVERNANCE_BOOTSTRAP (init unique)' },
  { rx: /^RECONCILIATION_\d{4}/i, label: 'RECONCILIATION datée' },
];

function collectMd(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (ARCHIVE_ZONES.some(z => rel === z || rel.startsWith(z + '/'))) continue;
      if (rel === 'node_modules' || rel.startsWith('node_modules/')) continue;
      collectMd(abs, results);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push({ abs, rel, name: entry.name });
    }
  }
  return results;
}

function analyze(file) {
  if (!file.rel.includes('/') && EXEMPT_FILES.has(file.name)) {
    return { status: 'exempt', signals: [] };
  }
  const signals = HISTORY_SIGNALS.filter(s => s.rx.test(file.name));
  if (!signals.length) return { status: 'ok', signals: [] };

  const inWarn = WARN_ZONES.some(z => file.rel.startsWith(z + '/') || file.rel === z);
  return { status: inWarn ? 'warn' : 'violation', signals };
}

function collectRootMd() {
  const results = [];
  if (!fs.existsSync(ROOT)) return results;
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const abs = path.join(ROOT, entry.name);
      results.push({ abs, rel: entry.name, name: entry.name });
    }
  }
  return results;
}

const files = [
  ...collectMd(path.join(ROOT, 'docs')),
  ...collectRootMd(),
];
const BASELINE_EXISTED = fs.existsSync(BASELINE_FILE);
const baseline = loadBaseline();

console.log(`\n${C.bld}Gate 5 — Linter anti-historique hors archive${C.r}  ${C.dim}(${files.length} .md scannés)${C.r}`);
console.log(`${C.dim}Mode : ${FULL ? 'full strict (baseline ignorée)' : 'ratchet'} · baseline : ${baseline.size} fichier(s)${C.r}\n`);

const violations = [];
const baselineDebt = [];
const warnings = [];
const rawViolations = [];
let okCount = 0;

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

  const item = { file, signals };
  rawViolations.push(item);
  if (!FULL && baseline.has(file.rel)) {
    baselineDebt.push(item);
    if (VERBOSE) console.log(`  ${C.ylw}▲${C.r}  ${file.rel}  ${C.dim}→ dette historique baseline${C.r}`);
    continue;
  }

  violations.push(item);
  console.log(`  ${C.red}✖${C.r}  ${C.bld}${file.rel}${C.r}`);
  signals.forEach(s => console.log(`       ${C.red}↳ ${s.label}${C.r}`));
  console.log(`       ${C.dim}→ déplace vers docs/_archive/ ou renomme sans signal historique.${C.r}`);
}

const rawViolationSet = new Set(rawViolations.map(v => v.file.rel));
const staleBaseline = [...baseline].filter(rel => !rawViolationSet.has(rel));
if (staleBaseline.length) {
  console.log(`\n${C.red}✖ ${staleBaseline.length} exemption(s) docs devenue(s) inutile(s) :${C.r}`);
  staleBaseline.forEach(rel => console.log(`${C.red}   ↓ ${rel}${C.r}`));
  console.log(`${C.dim}  Rétrécir scripts/.docs-history-lint-baseline.json ; une dette archivée/supprimée ne reste jamais baselinée.${C.r}`);
}

if (SAVE) {
  const next = saveBaseline(rawViolations, baseline, !BASELINE_EXISTED);
  console.log(`\n${C.cyn}↻ Baseline docs ${BASELINE_EXISTED ? 'réécrite' : 'amorcée'} : ${next.length} fichier(s) exempté(s) (${baseline.size} avant).${C.r}`);
}

console.log(`\n${C.bld}Bilan${C.r} : ${C.grn}${okCount} ok${C.r} · ${C.ylw}${warnings.length} avertissement(s)${C.r} · ${C.ylw}${baselineDebt.length} dette(s) baseline${C.r} · ${C.red}${violations.length} violation(s) nouvelle(s)${C.r}`);

if (baselineDebt.length && !FULL) {
  console.log(`${C.ylw}▲ ${baselineDebt.length} fichier(s) historique(s) restent hors archive mais sont gelés par baseline.${C.r}`);
  console.log(`${C.dim}  Nettoie-les progressivement, puis lance npm run gate:docs-lint:save pour rétrécir la baseline.${C.r}`);
}

if (violations.length || (STRICT && staleBaseline.length)) {
  console.log(`\n${C.red}${C.bld}✖ Gate 5 ÉCHEC — ${violations.length} nouveau(x) fichier(s) historique(s) hors archive :${C.r}`);
  violations.forEach(({ file }) => console.log(`${C.red}   ↳ ${file.rel}${C.r}`));
  console.log(`\n${C.dim}Règle : un fichier à signal historique ne vit que dans docs/_archive/.${C.r}`);
  console.log(`${C.dim}Checkpoint humain si ambigu : classer "À REVOIR" dans docs/chantier/STATUS.md.${C.r}`);
  if (STRICT) process.exit(1);
}

if (!violations.length && !staleBaseline.length) {
  console.log(`\n${C.grn}${C.bld}✔ Gate 5 OK — zéro dette historique hors archive, baseline exacte.${C.r}`);
}
