#!/usr/bin/env node
'use strict';

/**
 * business-graph-ratchet-check.js — Lot O4 / O4-2 : drift ratchet typé.
 *
 *   Régénère le Business Feature Graph (mêmes racines --dash-root public
 *   --boutique-root public/boutique que business-graph:check, cf. package.json)
 *   puis compare le nombre de warnings PAR CLÉ "TYPE::CATÉGORIE SÉMANTIQUE"
 *   à governance/business-graph-drift-baseline.json.
 *
 *   Lot O4-2 (point 2) : la granularité initiale (Phase F) ratchetait par
 *   TYPE seul. Trou constaté : un déplacement de dette D'UNE CATÉGORIE À UNE
 *   AUTRE au sein du même type (ex. un WRITER-NOT-OWNER qui glisse
 *   d'EXPECTED_TOPOLOGY vers ACTIONABLE_DRIFT) ne changeait pas le total du
 *   type -> passait inaperçu. Ratcheter par "TYPE::CATEGORY" ferme ce trou :
 *   chaque paire (type, catégorie) a sa propre limite indépendante.
 *
 *   Règle (mission O4 §10, étendue au point 2) :
 *     - count(type::cat) > baseline(type::cat)  -> FAIL (nouvelle dette silencieuse,
 *                                                   y compris un simple déplacement
 *                                                   de catégorie à total de type stable)
 *     - clé présente dans le graphe, absente
 *       de la baseline                          -> FAIL (nouvelle catégorie de dette,
 *                                                   doit être ajoutée explicitement)
 *     - count(type::cat) <= baseline(type::cat) -> PASS (une réduction n'échoue jamais)
 *     - clé dans la baseline, absente du
 *       graphe actuel (dette résorbée)          -> PASS + note (baseline peut être
 *                                                   resserrée dans un lot dédié)
 *
 *   Ce script n'écrit JAMAIS la baseline lui-même : la resserrer après une
 *   vraie réduction de dette est une décision explicite (édition manuelle de
 *   governance/business-graph-drift-baseline.json), jamais un effet de bord
 *   silencieux d'un run vert.
 *
 * Usage :
 *   node scripts/business-graph-ratchet-check.js
 *   node scripts/business-graph-ratchet-check.js --root DIR
 */

const fs   = require('fs');
const path = require('path');
const cp   = require('child_process');

const args = process.argv.slice(2);
function argVal(f) { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; }
const ROOT = path.resolve(argVal('--root') || path.join(__dirname, '..'));

const GRAPH_FILE    = path.join(ROOT, 'docs', 'BUSINESS_FEATURE_GRAPH.json');
const BASELINE_FILE = path.join(ROOT, 'governance', 'business-graph-drift-baseline.json');
const semantics      = require(path.join(ROOT, 'governance', 'business-graph-warning-semantics.js'));

const C = { red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m', dim: '\x1b[2m', bld: '\x1b[1m', r: '\x1b[0m' };

// ── 1. Régénère le graphe (source de vérité fraîche, pas un JSON périmé) ──
try {
  cp.execSync('node scripts/business-graph-gen.js --dash-root public --boutique-root public/boutique', {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (e) {
  console.error(`${C.red}${C.bld}✖ business-graph-ratchet-check : la génération du graphe a échoué (0 error attendu avant tout ratchet).${C.r}`);
  console.error((e.stdout || '').toString() + (e.stderr || '').toString());
  process.exit(1);
}

if (!fs.existsSync(GRAPH_FILE)) {
  console.error(`${C.red}✖ ${GRAPH_FILE} introuvable après génération.${C.r}`);
  process.exit(1);
}
if (!fs.existsSync(BASELINE_FILE)) {
  console.error(`${C.red}✖ ${BASELINE_FILE} introuvable — aucune baseline de ratchet définie.${C.r}`);
  process.exit(1);
}

const graph    = JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8'));
const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')).baseline || {};

if ((graph.drifts.error || []).length > 0) {
  console.error(`${C.red}${C.bld}✖ ${graph.drifts.error.length} ERROR(s) dans le graphe — le ratchet ne s'applique qu'aux warnings, corrige d'abord les erreurs.${C.r}`);
  process.exit(1);
}

// ── 2. Compte uniquement la dette réelle par clé "TYPE::CATEGORY" ─────────
// EXPECTED_TOPOLOGY et GENERATOR_LIMITATION restent visibles dans le graphe
// mais ne consomment jamais un budget de dette.
const rawSignals = graph.drifts.warn || [];
const semanticCtx = { ROOT, pairClassifications: (graph.o6 && graph.o6.pairClassifications) || [] };
const partition = semantics.partition(rawSignals, semanticCtx);
const warns = partition.debt;
const countByKey = {};   // "TYPE::CATEGORY" -> count
const typeOf = {};       // "TYPE::CATEGORY" -> TYPE (pour affichage groupé)
const categoryOf = {};   // "TYPE::CATEGORY" -> CATEGORY
for (const w of warns) {
  const { category } = semantics.classify(w, semanticCtx);
  const key = `${w.type}::${category}`;
  countByKey[key] = (countByKey[key] || 0) + 1;
  typeOf[key] = w.type;
  categoryOf[key] = category;
}

const allKeys = new Set([...Object.keys(countByKey), ...Object.keys(baseline)]);
const rows = [];
let hasFailure = false;

for (const key of [...allKeys].sort()) {
  const current = countByKey[key] || 0;
  const base    = Object.prototype.hasOwnProperty.call(baseline, key) ? baseline[key] : null;
  const type     = typeOf[key] || key.split('::')[0];
  const category = categoryOf[key] || key.split('::')[1];

  let status, note;
  if (base === null) {
    status = 'FAIL';
    note = 'nouvelle clé type::catégorie, absente de governance/business-graph-drift-baseline.json — ajoute-la explicitement après revue, ne laisse jamais une nouvelle catégorie passer silencieusement';
    hasFailure = true;
  } else if (current > base) {
    status = 'FAIL';
    note = `augmentation (${base} -> ${current}) — nouveau drift non budgétisé, y compris un simple déplacement de catégorie au sein du même type`;
    hasFailure = true;
  } else if (current < base) {
    status = 'PASS';
    note = `réduction (${base} -> ${current}) — la baseline peut être resserrée manuellement si la dette est vraiment résorbée`;
  } else {
    status = 'PASS';
    note = 'stable';
  }
  rows.push({ key, type, category, base, current, status, note });
}

// ── 3. Rapport (groupé par TYPE pour lisibilité, détail par CATEGORY) ────
console.log(`\n${C.bld}business-graph:ratchet-check — Lot O4-2 (ratchet type::catégorie)${C.r}\n`);
const rowsByType = {};
for (const r of rows) (rowsByType[r.type] = rowsByType[r.type] || []).push(r);
for (const type of Object.keys(rowsByType).sort()) {
  console.log(`  ${C.bld}${type}${C.r}`);
  for (const r of rowsByType[type]) {
    const col = r.status === 'FAIL' ? C.red : C.grn;
    const baseTxt = r.base === null ? C.ylw + 'absent de la baseline' + C.r : `baseline ${r.base}`;
    console.log(`    ${col}${r.status === 'FAIL' ? '✖' : '✔'}${C.r} ${C.dim}::${C.r}${r.category} — actuel ${r.current} (${baseTxt})`);
    console.log(`        ${C.dim}${r.note}${C.r}`);
  }
}

const totalCurrent = warns.length;
const totalBase    = Object.values(baseline).reduce((a, b) => a + b, 0);
console.log(`\n${C.dim}Dette/drift ratchetté : ${totalCurrent} (baseline totale ${totalBase}). Hors dette : ${partition.expectedTopology.length} topologie(s) attendue(s), ${partition.generatorLimitations.length} limite(s) générateur.${C.r}`);

if (hasFailure) {
  console.log(`\n${C.red}${C.bld}✖ business-graph:ratchet-check ÉCHEC — nouveau drift au-dessus de la baseline type::catégorie.${C.r}`);
  process.exit(1);
}
console.log(`\n${C.grn}${C.bld}✔ business-graph:ratchet-check OK — aucune dette nouvelle au-dessus de la baseline type::catégorie.${C.r}`);
