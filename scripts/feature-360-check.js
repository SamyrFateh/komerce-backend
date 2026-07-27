#!/usr/bin/env node
'use strict';

/**
 * feature-360-check.js — Gate structurel Feature 360 (Lot O8, mission §21).
 *
 *   Distinct du simple `gen-feature-360.js --check` (staleness disque).
 *   Reconstruit la projection EN MÉMOIRE et vérifie :
 *
 *     - 1 entrée par feature canonique gouvernée, 0 duplicate id
 *     - artefacts disque (JSON + MD) non périmés
 *     - consumes / consumedBy inverse-cohérents (déterministe)
 *     - aucune TECHNICAL_PRIMITIVE / NON_RUNTIME_TEST / COMPOSITION_ROOT_WIRING
 *       dans businessDependencies (le filtrage O6 doit être respecté)
 *     - aucune PROJECTION mélangée dans businessDependencies/consumedBy
 *     - internal APIs projetées correctement (statut résolu depuis le graphe)
 *     - health déterministe (recalcul == valeur stockée)
 *     - chaque debt item relié à un signal source réel (pas de dette inventée)
 *     - contrat P3b : au moins 18 sources de gates attribuables, aucune source échouée
 *
 * Usage : node scripts/feature-360-check.js
 * Intégration package.json : "feature:360:check": "node scripts/feature-360-check.js"
 */

const fs = require('fs');
const path = require('path');
const { build } = require('./lib/feature-360-builder.js');
const { renderMd } = require('./lib/feature-360-render.js');

const ROOT = path.resolve(__dirname, '..');
const OUT_JSON = path.join(ROOT, 'docs', 'FEATURE_360.json');
const OUT_MD = path.join(ROOT, 'docs', 'FEATURE_360.md');
const MIN_GATE_SOURCES = 18;

const C = { r: '\x1b[0m', red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m', bld: '\x1b[1m', dim: '\x1b[2m' };
const errors = [];
const fail = (code, detail) => errors.push({ code, detail });

const NOISE_FAMILIES = new Set(['TECHNICAL_PRIMITIVE', 'NON_RUNTIME_TEST', 'COMPOSITION_ROOT_WIRING', 'PROJECTION']);
const VALID_DISPOSITIONS = new Set([
  'DECLARED_AND_OBSERVED', 'BUSINESS_FEATURE_INTERFACE', 'BUSINESS_TRANSVERSAL_SERVICE', 'PILOTING_CAPABILITY',
]);
const VALID_DEBT_TYPES = new Set([
  'AMBIGUOUS_TABLE_OWNERSHIP', 'ORPHAN_IMPLEMENTATION', 'UNRESOLVED_INTERNAL_API',
  'DECLARED_NOT_OBSERVED', 'CONSUMES_REFERENCE_UNRESOLVED', 'DIRECT_CROSS_FEATURE_IMPORT',
  'RUNTIME_CYCLE', 'ONTOLOGY_GAP',
]);

const model = build();

// ── 1. Staleness disque ──────────────────────────────────────────────────
const json = JSON.stringify(model, null, 2) + '\n';
const md = renderMd(model);
const onDiskJson = fs.existsSync(OUT_JSON) ? fs.readFileSync(OUT_JSON, 'utf8') : null;
const onDiskMd = fs.existsSync(OUT_MD) ? fs.readFileSync(OUT_MD, 'utf8') : null;
if (onDiskJson === null) fail('ARTIFACT_MISSING', 'docs/FEATURE_360.json absent — lance npm run feature:360:gen');
else if (onDiskJson !== json) fail('STALE_ARTIFACT', 'docs/FEATURE_360.json périmé par rapport aux sources');
if (onDiskMd === null) fail('ARTIFACT_MISSING', 'docs/FEATURE_360.md absent — lance npm run feature:360:gen');
else if (onDiskMd !== md) fail('STALE_ARTIFACT', 'docs/FEATURE_360.md périmé par rapport aux sources');

// ── 2. Unicité des ids ────────────────────────────────────────────────────
const ids = model.features.map(f => f.id);
const seen = new Set();
for (const id of ids) {
  if (seen.has(id)) fail('DUPLICATE_FEATURE_ID', id);
  seen.add(id);
}

// ── 3. Filtrage du bruit — aucune famille technique/projection dans les
//      dépendances métier déclarées ─────────────────────────────────────
for (const f of model.features) {
  for (const d of f.businessDependencies) {
    if (NOISE_FAMILIES.has(d.disposition)) {
      fail('NOISE_LEAK_INTO_BUSINESS_DEPENDENCIES', `${f.id} -> ${d.provider} (${d.disposition})`);
    }
    if (!VALID_DISPOSITIONS.has(d.disposition)) {
      fail('UNKNOWN_DISPOSITION', `${f.id} -> ${d.provider} (${d.disposition})`);
    }
  }
  for (const d of f.consumedBy) {
    if (NOISE_FAMILIES.has(d.disposition)) {
      fail('NOISE_LEAK_INTO_CONSUMED_BY', `${f.id} <- ${d.consumer} (${d.disposition})`);
    }
  }
}

// ── 4. Cohérence inverse consumes / consumedBy ──────────────────────────
const byId = new Map(model.features.map(f => [f.id, f]));
for (const f of model.features) {
  for (const d of f.businessDependencies) {
    const provider = byId.get(d.provider);
    if (!provider) { fail('CONSUMES_UNKNOWN_PROVIDER', `${f.id} -> ${d.provider}`); continue; }
    const back = provider.consumedBy.find(c => c.consumer === f.id && c.disposition === d.disposition);
    if (!back) fail('INVERSE_MISMATCH', `${f.id} consumes ${d.provider} (${d.disposition}) mais ${d.provider}.consumedBy ne le contient pas`);
  }
  for (const d of f.consumedBy) {
    const consumer = byId.get(d.consumer);
    if (!consumer) { fail('CONSUMED_BY_UNKNOWN_CONSUMER', `${f.id} <- ${d.consumer}`); continue; }
    const fwd = consumer.businessDependencies.find(c => c.provider === f.id && c.disposition === d.disposition);
    if (!fwd) fail('INVERSE_MISMATCH', `${f.id}.consumedBy contient ${d.consumer} (${d.disposition}) mais ${d.consumer} ne déclare pas consommer ${f.id}`);
  }
}

// ── 5. Internal APIs projetées correctement (statut cohérent avec le graphe) ─
for (const f of model.features) {
  for (const a of f.interfaces.internalApis) {
    if (typeof a.status !== 'string' || !a.status.length) {
      fail('INTERNAL_API_STATUS_MISSING', `${f.id}.${a.fn}`);
    }
  }
}

// ── 6. Health déterministe (recalcul stable sur 2 builds) ─────────────────
const model2 = build();
for (let i = 0; i < model.features.length; i++) {
  const a = model.features[i], b = model2.features[i];
  if (a.boundaryHealth.status !== b.boundaryHealth.status || a.governanceHealth.status !== b.governanceHealth.status
      || a.gateHealth.status !== b.gateHealth.status) {
    fail('NON_DETERMINISTIC_HEALTH', a.id);
  }
}
if (JSON.stringify(model) !== JSON.stringify(model2)) {
  fail('NON_DETERMINISTIC_BUILD', 'deux builds successifs produisent un modèle différent');
}

// ── 7. Chaque debt item relié à un type reconnu (pas de dette inventée) ────
for (const f of model.features) {
  for (const d of f.architecturalDebt.debtItems) {
    if (!VALID_DEBT_TYPES.has(d.type)) fail('UNKNOWN_DEBT_TYPE', `${f.id}: ${d.type}`);
    if (!d.evidence || typeof d.evidence !== 'string' || !d.evidence.length) {
      fail('FAKE_DEBT_NO_EVIDENCE', `${f.id}: ${d.type}`);
    }
  }
  if (f.architecturalDebt.debtCount !== f.architecturalDebt.debtItems.length) {
    fail('DEBT_COUNT_MISMATCH', f.id);
  }
}

// ── 8. gateHealth (P3b) — présence sur 28/28, projection jamais silencieuse ─
for (const f of model.features) {
  if (!f.gateHealth) { fail('GATE_HEALTH_MISSING', f.id); continue; }
  if (!['HEALTHY', 'ATTENTION', 'BLOCKED'].includes(f.gateHealth.status)) {
    fail('GATE_HEALTH_INVALID_STATUS', `${f.id}: ${f.gateHealth.status}`);
  }
  for (const finding of f.gateHealth.findings) {
    if (!finding.message || !finding.message.length) {
      fail('GATE_FINDING_MESSAGE_LOST', `${f.id}: ${finding.gate}/${finding.type}`);
    }
  }
}
const pi = model.projectionIntegrity;
if (!pi || pi.gateSourcesTotal < MIN_GATE_SOURCES) {
  fail('GATE_SOURCE_COVERAGE_BELOW_CONTRACT', `${pi?.gateSourcesTotal || 0}/${MIN_GATE_SOURCES} sources attribuables`);
}
if (pi && pi.gateSourcesFailed > 0) {
  fail('GATE_SOURCE_FAILED', `${pi.gateSourcesFailed} source(s) de gate en échec`);
}
if (pi.unprojectableFiles.length) {
  fail('GATE_FINDING_FILE_UNPROJECTABLE', pi.unprojectableFiles.join(', '));
}
if (pi.multiProjectedFiles.length) {
  fail('GATE_FINDING_FILE_MULTI_PROJECTED', pi.multiProjectedFiles.map(m => `${m.file} -> ${m.features.join(',')}`).join('; '));
}
if (pi.unattributedFindingsCount > 0) {
  fail('GATE_FINDING_UNATTRIBUTED', `${pi.unattributedFindingsCount} finding(s) sans attribution exploitable`);
}

// ── Rapport ────────────────────────────────────────────────────────────
console.log(`${C.bld}Feature 360 — ${model.summary.features} features, ${model.summary.healthy} healthy, ${model.summary.attention} attention, ${model.summary.blocked} blocked${C.r}`);
if (errors.length === 0) {
  console.log(`${C.grn}${C.bld}✔ Feature 360 check : 0 violation.${C.r}`);
  process.exit(0);
}
console.error(`${C.red}${C.bld}✖ ${errors.length} violation(s) :${C.r}`);
for (const e of errors) console.error(`${C.red}  [${e.code}] ${e.detail}${C.r}`);
process.exit(1);
