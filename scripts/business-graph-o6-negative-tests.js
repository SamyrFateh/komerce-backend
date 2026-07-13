#!/usr/bin/env node
'use strict';

/**
 * scripts/business-graph-o6-negative-tests.js — Lot O6, tests L-T.
 *
 * Contrairement aux tests O5 (sandbox filesystem + observer réel), O6 opère
 * en aval de paires O5 déjà produites : chaque test construit un micro-modèle
 * synthétique de paires `{from,to,conformanceStatus,channels}` + un ctx
 * `{kindOf, compRootOwners, wiringFiles}` et appelle directement les fonctions
 * exportées par scripts/lib/feature-dependency-disposition.js — le même
 * module utilisé par business-graph-gen.js et business-graph-disposition-check.js.
 * Aucun état disque touché, aucune sandbox nécessaire.
 *
 * Usage : node scripts/business-graph-o6-negative-tests.js
 */

const assert = require('assert');
const disp = require('./lib/feature-dependency-disposition.js');

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

// ─── Helpers de fixtures ────────────────────────────────────────────────────
function staticPair(from, to, sourceFileId, targetFile) {
  return { from, to, conformanceStatus: 'OBSERVED_UNDECLARED', channels: [{ channel: 'static-code', evidence: [{ sourceFileId, targetFile }] }] };
}
function testOnlyPair(from, to, sourceFileId, targetFile) {
  return staticPair(from, to, sourceFileId, targetFile); // sourceFileId sous tests/ => TEST par fileEvidenceRole
}
const KINDS = {
  auth: 'technical-transversal', 'auth-identity': 'technical-transversal',
  infrastructure: 'technical-transversal', 'platform-ops': 'technical-transversal',
  notifications: 'business-transversal', documents: 'business-transversal',
  payments: 'business-feature', orders: 'business-feature', logistics: 'business-feature',
  wallet: 'business-feature', 'unknown-provider': undefined,
  'decision-signals': 'piloting-capability',
  'admin-dashboard': 'projection',
};
const kindOf = (f) => (f in KINDS ? KINDS[f] : 'business-feature');

const BASE_CTX = () => ({
  kindOf,
  compRootOwners: new Set(['infrastructure']),
  wiringFiles: new Set(['bootstrap/api-routes.js', 'bootstrap/crons.js', 'middleware/error-handler.js']),
});

// ─── L — nouvelle paire sans famille reconnue ──────────────────────────────
test('L — provider kind non reconnu (undefined businessKind) -> UNCLASSIFIED_OBSERVED_DEPENDENCY', () => {
  const pair = staticPair('payments', 'unknown-provider', 'services/payment-service.js', 'services/unknown-service.js');
  const KINDS_L = { ...KINDS, 'unknown-provider': 'not-a-known-kind' };
  const ctx = { ...BASE_CTX(), kindOf: (f) => (f in KINDS_L ? KINDS_L[f] : 'not-a-known-kind') };
  const c = disp.classifyPair(pair, ctx);
  assert.strictEqual(c.family, 'UNCLASSIFIED', `attendu UNCLASSIFIED, obtenu ${c.family}`);
});

// ─── M — exception stale ────────────────────────────────────────────────────
test('M — exception ledger pour une paire disparue d\'O5 -> STALE_DEPENDENCY_EXCEPTION', () => {
  const pairs = [staticPair('logistics', 'payments', 'services/parcel-auto-create-service.js', 'services/payment-service.js')];
  const dispositions = disp.buildDispositions(pairs, BASE_CTX());
  const ledger = { exceptions: [{ from: 'logistics', to: 'purchasing', decision: 'boundary-to-break', rationale: 'obsolète — la paire a disparu' }] };
  const recon = disp.reconcileExceptions(dispositions, ledger);
  assert.ok(recon.staleExceptions.includes('logistics->purchasing'), 'logistics->purchasing doit être détectée stale');
});

// ─── N — exception dupliquée ────────────────────────────────────────────────
test('N — deux entrées de ledger pour le même from->to -> DUPLICATE_EXCEPTION', () => {
  const pairs = [staticPair('payments', 'loyalty', 'services/payment-cash-confirm.js', 'services/loyalty-service.js')];
  const KINDS_N = { ...KINDS, payments: 'business-feature', loyalty: 'business-feature' };
  const ctx = { ...BASE_CTX(), kindOf: (f) => (f in KINDS_N ? KINDS_N[f] : 'business-feature') };
  const dispositions = disp.buildDispositions(pairs, ctx);
  const ledger = { exceptions: [
    { from: 'payments', to: 'loyalty', decision: 'internal-api-required', rationale: 'import direct' },
    { from: 'payments', to: 'loyalty', decision: 'internal-api-required', rationale: 'doublon' },
  ] };
  const recon = disp.reconcileExceptions(dispositions, ledger);
  assert.ok(recon.duplicateKeys.includes('payments->loyalty'), 'la clé dupliquée doit être détectée');
});

// ─── O — composition root mal classé (preuve wiring lue comme consommation métier) ─
test('O — preuve composition-root (fichier wiring) ne doit JAMAIS être classée CROSS_FEATURE_DIRECT_IMPORT/BUSINESS_*', () => {
  const pair = staticPair('infrastructure', 'loyalty', 'bootstrap/api-routes.js', 'routes/loyalty.js');
  const c = disp.classifyPair(pair, BASE_CTX());
  assert.strictEqual(c.family, 'COMPOSITION_ROOT_WIRING', `une preuve issue de bootstrap/api-routes.js chez le owner composition-root doit rester COMPOSITION_ROOT_WIRING, pas ${c.family}`);
  assert.notStrictEqual(c.family, 'CROSS_FEATURE_DIRECT_IMPORT');
  assert.notStrictEqual(c.family, 'BUSINESS_FEATURE_INTERFACE');
});

// ─── P — faux composition root par nom (fichier runtime NON wiring) ────────
test('P — infrastructure -> business-feature depuis un fichier runtime NON reconnu wiring -> UNCLASSIFIED (le nom ne suffit jamais)', () => {
  const pair = staticPair('infrastructure', 'loyalty', 'services/some-other-infra-service.js', 'services/loyalty-service.js');
  const c = disp.classifyPair(pair, BASE_CTX());
  assert.strictEqual(c.family, 'UNCLASSIFIED', `attendu UNCLASSIFIED (fichier hors allowlist wiring), obtenu ${c.family}`);
});

// ─── Q — test-only ──────────────────────────────────────────────────────────
test('Q — preuve exclusivement sous tests/ -> NON_RUNTIME_TEST', () => {
  const pair = testOnlyPair('auth', 'notifications', 'tests/unit/otp-route.test.js', 'services/notification-service.js');
  const c = disp.classifyPair(pair, BASE_CTX());
  assert.strictEqual(c.family, 'NON_RUNTIME_TEST', `attendu NON_RUNTIME_TEST, obtenu ${c.family}`);
});

// ─── R — faux cycle auth/auth-identity ──────────────────────────────────────
test('R — auth->auth-identity test-only + auth-identity->auth runtime -> aucun cycle runtime détecté', () => {
  const pairs = [
    testOnlyPair('auth', 'auth-identity', 'tests/unit/auth-route.test.js', 'routes/auth.js'),
    staticPair('auth-identity', 'auth', 'routes/client-auth.js', 'middleware/auth.js'),
  ];
  const dispositions = disp.buildDispositions(pairs, BASE_CTX());
  const found = dispositions.cycles.some(cy => cy.nodes.includes('auth') && cy.nodes.includes('auth-identity'));
  assert.strictEqual(found, false, 'aucun cycle runtime auth<->auth-identity ne doit être reconstruit — un sens est test-only');
});

// ─── S — localManifestGap non couvert ───────────────────────────────────────
test('S — localManifestGap (canonicalFeature=null) sans entrée ontology-gaps -> uncovered (ERROR au gate)', () => {
  const gaps = [{ consumerManifest: 'synthetic-widget', providerFeature: 'payments', channel: 'static-code' }];
  const registry = { gaps: [{ boutiqueManifest: 'tracking', finding: 'autre cas, déjà gouverné' }] };
  const coverage = disp.reconcileOntologyGaps(gaps, registry);
  assert.ok(coverage.uncovered.includes('synthetic-widget'), 'synthetic-widget doit être signalé NON couvert');
  assert.strictEqual(coverage.covered.includes('synthetic-widget'), false);
});

// ─── T — cycle runtime non expliqué (aucune décision au ledger) ────────────
test('T — A->B & B->A runtime sans exception au ledger -> UNEXPLAINED_RUNTIME_CYCLE', () => {
  const pairs = [
    staticPair('logistics', 'payments', 'services/parcel-auto-create-service.js', 'services/payment-service.js'),
    staticPair('payments', 'logistics', 'services/payment-paypal.js', 'routes/pickup-secret.js'),
  ];
  const dispositions = disp.buildDispositions(pairs, BASE_CTX());
  const recon = disp.reconcileExceptions(dispositions, { exceptions: [] });
  assert.ok(recon.unexplainedRuntimeCycles.some(c => c.key === 'logistics<->payments'), 'le cycle logistics<->payments doit être signalé sans décision');
});

// ─── Contrôles complémentaires (garde-fous directement issus du prompt) ─────
test('bonus — famille MISSING_EXCEPTION : CROSS_FEATURE_DIRECT_IMPORT sans entrée ledger', () => {
  const pairs = [staticPair('orders', 'payments', 'services/admin-order-refund.js', 'services/payment-service.js')];
  const KINDS_B = { ...KINDS, orders: 'business-feature', payments: 'business-feature' };
  const ctx = { ...BASE_CTX(), kindOf: (f) => (f in KINDS_B ? KINDS_B[f] : 'business-feature') };
  const dispositions = disp.buildDispositions(pairs, ctx);
  const recon = disp.reconcileExceptions(dispositions, { exceptions: [] });
  assert.ok(recon.missingExceptions.includes('orders->payments'), 'orders->payments (CROSS_FEATURE_DIRECT_IMPORT) doit exiger une entrée de ledger');
});

test('bonus — ILLEGITIMATE_EXCEPTION : entrée de ledger pour une paire mécaniquement fermée (TECHNICAL_PRIMITIVE)', () => {
  const pairs = [staticPair('auth-identity', 'auth', 'routes/client-auth.js', 'middleware/auth.js')];
  const dispositions = disp.buildDispositions(pairs, BASE_CTX());
  const ledger = { exceptions: [{ from: 'auth-identity', to: 'auth', decision: 'no-op', rationale: 'inutile' }] };
  const recon = disp.reconcileExceptions(dispositions, ledger);
  assert.ok(recon.illegitimateExceptions.includes('auth-identity->auth'), 'une exception sur une paire TECHNICAL_PRIMITIVE (fermée mécaniquement) doit être illégitime');
});

test('bonus — EMPTY_RATIONALE : entrée de ledger sans rationale', () => {
  const pairs = [staticPair('orders', 'payments', 'services/admin-order-refund.js', 'services/payment-service.js')];
  const KINDS_B = { ...KINDS, orders: 'business-feature', payments: 'business-feature' };
  const ctx = { ...BASE_CTX(), kindOf: (f) => (f in KINDS_B ? KINDS_B[f] : 'business-feature') };
  const dispositions = disp.buildDispositions(pairs, ctx);
  const ledger = { exceptions: [{ from: 'orders', to: 'payments', decision: 'internal-api-required', rationale: '' }] };
  const recon = disp.reconcileExceptions(dispositions, ledger);
  assert.ok(recon.emptyRationale.includes('orders->payments'), 'rationale vide doit être signalée');
});

console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed ? 1 : 0);
