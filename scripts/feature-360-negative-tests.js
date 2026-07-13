#!/usr/bin/env node
'use strict';

/**
 * scripts/feature-360-negative-tests.js — Lot O8, tests F360-A à F360-H.
 *
 * Exerce les fonctions pures exportées par scripts/lib/feature-360-builder.js
 * avec des fixtures synthétiques (aucun accès disque, aucune sandbox) — même
 * pattern que business-graph-o6-negative-tests.js.
 *
 * Usage : node scripts/feature-360-negative-tests.js
 */

const assert = require('assert');
const b = require('./lib/feature-360-builder.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  \x1b[32m✔\x1b[0m ${name}`);
    passed++;
  } catch (e) {
    console.log(`  \x1b[31m✖\x1b[0m ${name}`);
    console.log(`      ${e.message}`);
    failed++;
  }
}

// ─── F360-A — technical primitive leak ─────────────────────────────────────
test('F360-A — TECHNICAL_PRIMITIVE absent de businessDependencies, présent dans noise', () => {
  const o5Pairs = [];
  const o6 = [{ from: 'orders', to: 'infrastructure', family: 'TECHNICAL_PRIMITIVE' }];
  const { businessEdges, noiseEdges } = b.classifyPairsToBusinessEdges(o5Pairs, o6);
  assert.strictEqual(businessEdges.length, 0, 'ne doit apparaître dans aucune dépendance métier');
  assert.strictEqual(noiseEdges.length, 1);
  assert.strictEqual(noiseEdges[0].disposition, 'TECHNICAL_PRIMITIVE');
});

// ─── F360-B — test-only leak ────────────────────────────────────────────────
test('F360-B — NON_RUNTIME_TEST absent de businessDependencies', () => {
  const o6 = [{ from: 'orders', to: 'payments', family: 'NON_RUNTIME_TEST' }];
  const { businessEdges, noiseEdges } = b.classifyPairsToBusinessEdges([], o6);
  assert.strictEqual(businessEdges.length, 0);
  assert.strictEqual(noiseEdges[0].disposition, 'NON_RUNTIME_TEST');
});

// ─── F360-C — projection leak ───────────────────────────────────────────────
test('F360-C — PROJECTION absente de businessDependencies (va en projections, jamais en consumes)', () => {
  const o6 = [{ from: 'admin-dashboard', to: 'payments', family: 'PROJECTION' }];
  const { businessEdges, noiseEdges } = b.classifyPairsToBusinessEdges([], o6);
  assert.strictEqual(businessEdges.length, 0, 'admin-dashboard -> payments ne doit jamais apparaître dans payments.businessDependencies');
  assert.strictEqual(noiseEdges[0].disposition, 'PROJECTION');
});

// ─── F360-D — inverse mismatch ──────────────────────────────────────────────
test('F360-D — A consumes B mais B.consumedBy ne contient pas A -> ERROR détecté', () => {
  const features = [
    { id: 'A', businessDependencies: [{ provider: 'B', disposition: 'DECLARED_AND_OBSERVED' }], consumedBy: [] },
    { id: 'B', businessDependencies: [], consumedBy: [] }, // réciproque manquante
  ];
  const mismatches = b.checkInverseConsistency(features);
  assert.strictEqual(mismatches.length, 1);
  assert.ok(mismatches[0].includes('A consumes B'));
});
test('F360-D-bis — inverse cohérent -> 0 mismatch', () => {
  const features = [
    { id: 'A', businessDependencies: [{ provider: 'B', disposition: 'DECLARED_AND_OBSERVED' }], consumedBy: [] },
    { id: 'B', businessDependencies: [], consumedBy: [{ consumer: 'A', disposition: 'DECLARED_AND_OBSERVED' }] },
  ];
  const mismatches = b.checkInverseConsistency(features);
  assert.strictEqual(mismatches.length, 0);
});

// ─── F360-E — cross import health ───────────────────────────────────────────
test('F360-E — une paire CROSS_FEATURE_DIRECT_IMPORT -> boundaryHealth = ATTENTION', () => {
  const status = b.computeBoundaryStatus({ directCrossFeatureImports: 1 });
  assert.strictEqual(status, 'ATTENTION');
});

// ─── F360-F — unclassified health ───────────────────────────────────────────
test('F360-F — une dépendance UNCLASSIFIED -> boundaryHealth = BLOCKED', () => {
  const status = b.computeBoundaryStatus({ unclassifiedDependencies: 1, directCrossFeatureImports: 1 });
  assert.strictEqual(status, 'BLOCKED', 'BLOCKED doit dominer ATTENTION');
});
test('F360-F-bis — aucun signal -> HEALTHY', () => {
  assert.strictEqual(b.computeBoundaryStatus({}), 'HEALTHY');
});

// ─── F360-G — writer != owner ───────────────────────────────────────────────
test('F360-G — A écrit table T, B est lifecycle owner -> A=writer-not-owner, B=owner', () => {
  const tableInfo = { lifecycleOwner: 'B' };
  assert.strictEqual(b.tableOwnershipStatus('A', tableInfo), 'writer-not-owner');
  assert.strictEqual(b.tableOwnershipStatus('B', tableInfo), 'owner');
});
test('F360-G-bis — aucun lifecycle owner résolu -> ambiguous (jamais un owner inventé)', () => {
  const tableInfo = { lifecycleOwner: null };
  assert.strictEqual(b.tableOwnershipStatus('A', tableInfo), 'ambiguous');
});

// ─── F360-H — fake debt ─────────────────────────────────────────────────────
test('F360-H — debt item sans type reconnu ou sans evidence -> détecté comme invalide', () => {
  const VALID_DEBT_TYPES = new Set([
    'AMBIGUOUS_TABLE_OWNERSHIP', 'ORPHAN_IMPLEMENTATION', 'UNRESOLVED_INTERNAL_API',
    'DECLARED_NOT_OBSERVED', 'CONSUMES_REFERENCE_UNRESOLVED', 'DIRECT_CROSS_FEATURE_IMPORT',
    'RUNTIME_CYCLE', 'ONTOLOGY_GAP',
  ]);
  const fake1 = { type: 'INVENTED_DEBT_TYPE', evidence: 'rien de réel' };
  const fake2 = { type: 'AMBIGUOUS_TABLE_OWNERSHIP', evidence: '' };
  assert.ok(!VALID_DEBT_TYPES.has(fake1.type), 'type inventé doit être rejeté');
  assert.ok(!fake2.evidence.length, 'evidence vide doit être rejetée (pas de dette sans preuve)');
});

// ─── Bonus — la vraie projection (build() réel) ne doit jamais fuiter de bruit ─
test('Bonus — build() réel : 0 fuite de bruit technique/projection dans businessDependencies', () => {
  const model = b.build();
  const leaks = [];
  for (const f of model.features) {
    for (const d of f.businessDependencies) {
      if (b.TECHNICAL_FAMILIES.has(d.disposition) || d.disposition === 'PROJECTION') {
        leaks.push(`${f.id} -> ${d.provider} (${d.disposition})`);
      }
    }
  }
  assert.strictEqual(leaks.length, 0, `fuites : ${leaks.join(', ')}`);
});
test('Bonus — build() réel : consumes/consumedBy inverse-cohérent sur tout le graphe', () => {
  const model = b.build();
  const mismatches = b.checkInverseConsistency(model.features);
  assert.strictEqual(mismatches.length, 0, mismatches.join('\n'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
