'use strict';
/** @test-kind unit @test-runner jest @test-requires none */

test('file paiements fournisseurs : statuts et motifs affichés en français', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../public/dashboards/canonical/js/finance-decision.js'), 'utf8');
  expect(src).toContain("PAYMENT_AMBIGUOUS_RECONCILIATION_REQUIRED: 'rapprochement à confirmer'");
  expect(src).toContain("unverified: 'non vérifié'");
  expect(src).not.toContain("row.review_reason || null");
});

test('file fournisseurs Finance : rows, empty et not-provided restent distincts', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../public/dashboards/canonical/js/finance-decision.js'), 'utf8');
  expect(src).toContain('const supplierState = supplierReviewState(payload);');
  expect(src).toContain("review.section.setAttribute('data-review-state', supplierState.state)");
  expect(src).toContain("if (supplierState.state === 'rows')");
  expect(src).toContain('supplierState.message');
  expect(src).toContain('Non disponible dans cette vue');
  expect(src).toContain('Aucun paiement fournisseur ambigu');
});

test('Finance : accès utiles vers commandes à finaliser et analyse, absence = non disponible (jamais zéro)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../public/dashboards/canonical/js/finance-decision.js'), 'utf8');
  expect(src).toContain("data-finance-link', 'orders-to-finalize'");
  expect(src).toContain("data-finance-link', 'economic-analysis'");
  expect(src).toContain('const known = Array.isArray(payload && payload.incomplete_cost_orders);');
  expect(src).toContain('Commandes à finaliser : non disponible');
});

test('L10 : Finance affiche « Commandes payées — part hors avoir », jamais « CA encaissé »', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../public/dashboards/canonical/js/finance-decision.js'), 'utf8');
  expect(src).not.toMatch(/CA encaissé/);
  expect(src).toContain('Commandes payées — part hors avoir');
  expect(src).toContain('Ni chiffre d’affaires comptable, ni encaissement attesté.');
});

test('Finance : « à établir » et « marge finalisée » nomment leur cohorte (plus de 12 vs 0/11 ambigu)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/finance-decision.js'), 'utf8');
  expect(src).toContain('Commandes aux coûts à établir (');
  expect(src).toContain('payées)');
  expect(src).toContain('incomplete_cost_orders_total');
});
