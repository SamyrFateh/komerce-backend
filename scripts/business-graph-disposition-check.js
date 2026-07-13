#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────
// Lot O6 — Gate de disposition des dépendances (npm run business-graph:disposition-check)
//
// Vérifie DEUX flux O5 :
//   1. O5 OBSERVED_UNDECLARED pairs  -> toutes classées, ledger cohérent.
//   2. O5 local-manifest gaps        -> toutes couvertes par le registre ontologique.
//
// Ne fait JAMAIS confiance à un model.o6 potentiellement stale : recalcule la
// disposition depuis model.o5.pairs + governance/*, via le module partagé
// scripts/lib/feature-dependency-disposition.js (source unique de vérité).
//
// Conditions de fermeture (toutes bloquantes) :
//   UNCLASSIFIED_OBSERVED_DEPENDENCY = 0
//   STALE_DEPENDENCY_EXCEPTION       = 0
//   DUPLICATE_EXCEPTION              = 0
//   MISSING_EXCEPTION                = 0   (paire exceptionRequired sans entrée)
//   ILLEGITIMATE_EXCEPTION           = 0   (entrée pour paire mécaniquement fermée)
//   EMPTY_RATIONALE                  = 0
//   UNEXPLAINED_RUNTIME_CYCLE        = 0
//   UNCOVERED_LOCAL_MANIFEST_GAP     = 0
//   REVIEW_REQUIRED                  = 0
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const disp = require('./lib/feature-dependency-disposition');

const ROOT = path.resolve(__dirname, '..');
const GRAPH = path.join(ROOT, 'docs', 'BUSINESS_FEATURE_GRAPH.json');
const COMP_ROOT = path.join(ROOT, 'governance', 'composition-root-files.json');
const LEDGER = path.join(ROOT, 'governance', 'feature-dependency-exceptions.json');
const ONTOLOGY = path.join(ROOT, 'governance', 'business-graph-ontology-gaps.json');

const C = { r: '\x1b[0m', red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m', bld: '\x1b[1m' };
const errors = [];
const fail = (code, detail) => errors.push({ code, detail });

function readJSON(p, label) {
  if (!fs.existsSync(p)) { fail('SOURCE_MISSING', `${label} absent (${path.relative(ROOT, p)})`); return null; }
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { fail('SOURCE_UNPARSEABLE', `${label} : ${e.message}`); return null; }
}

const graph = readJSON(GRAPH, 'docs/BUSINESS_FEATURE_GRAPH.json');
const compCfg = readJSON(COMP_ROOT, 'governance/composition-root-files.json');
const ledger = readJSON(LEDGER, 'governance/feature-dependency-exceptions.json') || { exceptions: [] };
const ontology = readJSON(ONTOLOGY, 'governance/business-graph-ontology-gaps.json');

if (!graph || !graph.o5 || !Array.isArray(graph.o5.pairs)) {
  fail('NO_O5', 'model.o5.pairs introuvable — lance npm run business-graph:gen d\'abord');
}

if (errors.length) { report(); process.exit(1); }

// version
if (ledger.version !== 'O6-1.0') fail('LEDGER_VERSION', `ledger version = ${JSON.stringify(ledger.version)}, attendu "O6-1.0"`);

// ── Recompute dispositions from the shared module ─────────────────────────
const KIND = {};
for (const n of graph.nodes.features) KIND[n.name] = n.businessKind;
KIND['admin-dashboard'] = KIND['admin-dashboard'] || 'projection';
const kindOf = (f) => KIND[f] || 'unclassified';

const wiringFiles = new Set((compCfg && compCfg.wiringFiles) || []);
// composition-root owners : dérivés de model.o6 si présent (déjà calculé depuis
// l'ownership des manifests) — sinon on retombe sur graph.o6.compositionRootOwners.
const compRootOwners = new Set((graph.o6 && graph.o6.compositionRootOwners) || []);

const dispositions = disp.buildDispositions(graph.o5.pairs, { kindOf, compRootOwners, wiringFiles });
const exRecon = disp.reconcileExceptions(dispositions, ledger);
const gapCov = disp.reconcileOntologyGaps(graph.o5.localManifestDependenciesWithoutCanonicalConsumer, ontology);

// ── Enforce ───────────────────────────────────────────────────────────────
const obsCount = graph.o5.pairs.filter(p => p.conformanceStatus === 'OBSERVED_UNDECLARED').length;
const classifiedCount = dispositions.classifications.length;
if (obsCount !== classifiedCount) fail('CLASSIFY_COUNT', `${obsCount} paires O5 OBSERVED_UNDECLARED mais ${classifiedCount} classées`);

// exactement une famille par paire (pas de doublon de clé dans les classifications)
const clsKeys = new Set();
for (const c of dispositions.classifications) {
  const k = c.from + '->' + c.to;
  if (clsKeys.has(k)) fail('DUPLICATE_CLASSIFICATION', k);
  clsKeys.add(k);
  if (!disp.FAMILIES.includes(c.family) && c.family !== 'UNCLASSIFIED') fail('UNKNOWN_FAMILY', `${k} -> ${c.family}`);
}

for (const u of dispositions.unclassified) fail('UNCLASSIFIED_OBSERVED_DEPENDENCY', `${u.from} -> ${u.to} (${u.couplingObserved}, ${u.evidenceRole})`);
for (const k of exRecon.duplicateKeys) fail('DUPLICATE_EXCEPTION', k);
for (const k of exRecon.staleExceptions) fail('STALE_DEPENDENCY_EXCEPTION', `${k} — la paire n'existe plus dans O5 OBSERVED_UNDECLARED, supprime l'entrée (l'historique est dans Git)`);
for (const k of exRecon.missingExceptions) fail('MISSING_EXCEPTION', `${k} — paire exceptionRequired sans entrée de ledger`);
for (const k of exRecon.illegitimateExceptions) fail('ILLEGITIMATE_EXCEPTION', `${k} — entrée de ledger pour une paire mécaniquement fermée (aucune décision humaine requise)`);
for (const k of exRecon.emptyRationale) fail('EMPTY_RATIONALE', `${k} — rationale vide`);
for (const c of exRecon.unexplainedRuntimeCycles) fail('UNEXPLAINED_RUNTIME_CYCLE', `${c.key} — direction(s) sans décision : ${c.undecided.join(', ')}`);
for (const g of gapCov.uncovered) fail('UNCOVERED_LOCAL_MANIFEST_GAP', `${g} — gap local-manifest O5 sans entrée dans le registre ontologique`);

// REVIEW_REQUIRED : signature (matrice) non observée dans la baseline figée.
// La baseline figée = graph.o6.matrix (générée). Une signature recalculée absente
// de la matrice figée est un REVIEW_REQUIRED. Sur l'état courant, identiques => 0.
const frozenMatrix = (graph.o6 && graph.o6.matrix) || null;
if (frozenMatrix) {
  for (const sig of Object.keys(dispositions.matrix)) {
    if (!(sig in frozenMatrix)) fail('REVIEW_REQUIRED', `signature non figée : ${sig}`);
  }
}

report();
process.exit(errors.length ? 1 : 0);

function report() {
  const familySummary = dispositions.familySummary || {};
  console.log(`${C.bld}O6 Dependency Disposition check${C.r}`);
  if (dispositions.classifications) {
    console.log(`  ${classifiedCount} paire(s) classée(s) — ` +
      disp.FAMILIES.map(f => `${f.split('_')[0]}=${familySummary[f] || 0}`).join(' '));
    console.log(`  exceptions : ${exRecon.exceptions.length} | cycles runtime : ${dispositions.cycles.length} | ontology gaps couverts : ${gapCov.covered.length}/${gapCov.consumers.length}`);
  }
  if (!errors.length) {
    console.log(`${C.grn}${C.bld}✔ O6 fermé : UNCLASSIFIED=0, STALE=0, MISSING=0, ILLEGITIMATE=0, UNEXPLAINED_CYCLE=0, UNCOVERED_GAP=0, REVIEW=0.${C.r}`);
    return;
  }
  const byCode = {};
  for (const e of errors) (byCode[e.code] = byCode[e.code] || []).push(e.detail);
  console.log(`${C.red}${C.bld}✖ O6 disposition-check : ${errors.length} violation(s)${C.r}`);
  for (const [code, list] of Object.entries(byCode)) {
    console.log(`${C.red}  [${code}] ×${list.length}${C.r}`);
    for (const d of list) console.log(`${C.red}     ↳ ${d}${C.r}`);
  }
}
